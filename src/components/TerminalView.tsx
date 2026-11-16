import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptyResize, ptySnapshot, ptyWrite } from "../lib/api";
import { decode, subscribe, type OutputEv } from "../lib/ptyEvents";

interface Props {
  sessionId: string;
  active: boolean;
  exitText: (code: number | null) => string;
  onExit?: (code: number | null) => void;
}

export default function TerminalView({ sessionId, active, exitText, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ fit: () => void; focus: () => void } | null>(null);
  const cb = useRef({ exitText, onExit });
  useEffect(() => {
    cb.current = { exitText, onExit };
  });

  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 5000,
      fontFamily: "ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace",
      theme: { background: "#09090b" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);

    const fit = () => {
      if (el.offsetParent !== null && el.clientWidth > 0) {
        try {
          fitAddon.fit();
        } catch {
          /* nog niet zichtbaar */
        }
      }
    };
    api.current = { fit, focus: () => term.focus() };

    let disposed = false;
    let live = false;
    let offset = 0;
    let exited = false;
    const queue: OutputEv[] = [];
    const write = (ev: OutputEv) => {
      if (ev.end_offset > offset) {
        offset = ev.end_offset;
        term.write(decode(ev.data));
      }
    };
    const announceExit = (code: number | null) => {
      if (exited) return;
      exited = true;
      term.write(`\r\n\x1b[90m${cb.current.exitText(code)}\x1b[0m\r\n`);
      cb.current.onExit?.(code);
    };

    let unsubscribe: (() => void) | undefined;
    void subscribe(sessionId, {
      output: (ev) => (live ? write(ev) : queue.push(ev)),
      exit: announceExit,
    }).then(async (u) => {
      if (disposed) return u();
      unsubscribe = u;
      try {
        const snap = await ptySnapshot(sessionId);
        if (disposed) return;
        term.write(decode(snap.data));
        offset = snap.end_offset;
        live = true;
        queue.splice(0).forEach(write);
        if (snap.exited) announceExit(snap.exit_code);
      } catch {
        live = true;
      }
      fit();
    });

    const d1 = term.onData((d) => void ptyWrite(sessionId, d).catch(() => undefined));
    const d2 = term.onResize(({ rows, cols }) => void ptyResize(sessionId, rows, cols).catch(() => undefined));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();

    return () => {
      disposed = true;
      unsubscribe?.();
      ro.disconnect();
      d1.dispose();
      d2.dispose();
      term.dispose();
      api.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (active) {
      api.current?.fit();
      api.current?.focus();
    }
  }, [active]);

  return <div ref={host} className={`h-full w-full bg-zinc-950 p-2 ${active ? "" : "hidden"}`} />;
}

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  chatBusy,
  chatHistory,
  chatModeSet,
  chatRetry,
  chatSend,
  chatStop,
  chatSwitch,
  chatTarget,
  cliStatus,
  permissionAnswer,
  runtime,
  type Account,
  type ChatMessage,
  type ChatMode,
  type ChatOut,
  type ChatStatus,
  type ChatTarget,
  type CliStatus,
  type Project,
  type Provider,
  type RestoreResult,
} from "../../lib/api";
import InstallGuide from "../InstallGuide";
import ChatSwitchDialog from "./ChatSwitchDialog";
import VersionsDialog from "./VersionsDialog";
import MessageView from "./MessageView";
import PermissionDialog from "./PermissionDialog";

interface Props {
  project: Project;
  accounts: Account[];
  /** "Technisch"-stand: ruwe details staan standaard open. */
  technical: boolean;
  onOpenAdvanced: () => void;
  onOpenAccounts: () => void;
  onError: (msg: string) => void;
}

const QUICK = ["mooier", "mobiel", "klopt", "veranderd"] as const;

export default function ChatPanel({ project, accounts, technical, onOpenAdvanced, onOpenAccounts, onError }: Props) {
  const { t } = useTranslation();
  const id = project.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("build");
  const [missing, setMissing] = useState<CliStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => onError(t("fout.algemeen", { bericht: String(e) })), [onError, t]);

  // Geschiedenis, doel-AI en of er al iets bezig is: bij het (her)openen van het project.
  useEffect(() => {
    let cancelled = false;
    Promise.all([chatTarget(id), chatHistory(id), chatBusy(id)])
      .then(([tg, h, b]) => {
        if (cancelled) return;
        setTarget(tg);
        setMode(tg.mode ?? "build");
        setMessages(h);
        setBusy(b);
        setStatus(b ? "thinking" : "idle");
        setFallback(h.some((m) => m.kind === "notice" && m.payload.kind === "fallback") && h.at(-1)?.kind === "notice");
      })
      .catch((e) => !cancelled && fail(e));
    return () => {
      cancelled = true;
    };
  }, [id, fail]);

  // Live gebeurtenissen van de AI.
  useEffect(() => {
    const un = listen<ChatOut>("chat-out", (e) => {
      const ev = e.payload;
      if (ev.project_id !== id) return;
      if (ev.type === "message") setMessages((m) => (m.some((x) => x.id === ev.message.id) ? m : [...m, ev.message]));
      else if (ev.type === "update") setMessages((m) => m.map((x) => (x.id === ev.message.id ? ev.message : x)));
      else if (ev.type === "status") {
        setStatus(ev.state);
        setBusy(ev.busy);
      } else if (ev.type === "fallback") setFallback(true);
      else if (ev.type === "mode") setMode(ev.mode);
    });
    return () => void un.then((f) => f());
  }, [id]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, status]);

  async function send(body: string) {
    const trimmed = body.trim();
    if (!trimmed || !target?.structured) return;
    try {
      const st = await cliStatus(target.provider);
      if (!st.installed) return setMissing(st);
      setMissing(null);
      setText("");
      await chatSend(id, trimmed);
    } catch (e) {
      fail(e);
    }
  }

  async function chooseMode(m: ChatMode) {
    if (m === mode) return;
    setMode(m);
    try {
      await chatModeSet(id, m);
    } catch (e) {
      fail(e);
    }
  }

  // Uit de bug-lus: eerst overleggen in plaats van verder bouwen.
  async function discuss() {
    try {
      await chatModeSet(id, "plan");
      setMode("plan");
      await chatSend(id, t("chat.lus.overlegPrompt"));
    } catch (e) {
      fail(e);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  }

  async function switchTo(provider: Provider, accountId: number | null) {
    setSwitching(false);
    try {
      setFallback(false);
      setTarget(await chatSwitch(id, provider, accountId));
    } catch (e) {
      fail(e);
    }
  }

  const lastLoopId = [...messages].reverse().find((x) => x.kind === "loop_alert")?.id;
  const asked = messages.find((m) => m.kind === "permission" && m.payload.state === "asked") ?? null;
  const aiName = target ? t(`provider.${target.provider}`) : "";
  const unavailable = target && (!target.structured || fallback);

  return (
    <section aria-label={t("chat.titel")} className="flex h-full min-h-0 flex-col bg-zinc-950">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-5 py-3">
        <h2 className="text-lg font-semibold">
          {t("chat.titel")}
          {target && <span className="ml-2 text-base font-normal text-zinc-400">{aiName}{target.account_label ? ` · ${target.account_label}` : ""}</span>}
        </h2>
        <div className="flex gap-2">
          <button onClick={() => setShowVersions(true)} className="min-h-10 rounded-lg border border-zinc-600 px-3 text-base hover:bg-zinc-800">
            {t("versies.knop")}
          </button>
          <button onClick={() => setSwitching(true)} className="min-h-10 rounded-lg border border-zinc-600 px-3 text-base hover:bg-zinc-800">
            {t("chat.wissel")}
          </button>
          <button onClick={onOpenAdvanced} className="min-h-10 rounded-lg border border-zinc-600 px-3 text-base hover:bg-zinc-800">
            {t("chat.technisch")}
          </button>
        </div>
      </header>

      <div role="log" aria-live="polite" aria-label={t("chat.geschiedenis")} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !unavailable && <p className="text-lg text-zinc-300">{t("chat.leeg")}</p>}
        {messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            live={busy}
            technical={technical}
            canRetry={!busy && m.id === [...messages].reverse().find((x) => x.kind === "error")?.id}
            onRetry={() => void chatRetry(id).catch(fail)}
            onOpenAccounts={onOpenAccounts}
            loop={{
              active: m.id === lastLoopId && !busy,
              onRestore: async (hash) => {
                await runtime<RestoreResult>(id, "git.restore", { hash });
              },
              onDiscuss: () => void discuss(),
              onOtherAi: () => setSwitching(true),
            }}
          />
        ))}
        {missing && <InstallGuide status={missing} onInstalled={() => setMissing(null)} />}
        {unavailable && (
          <div role="note" data-testid="terminal-fallback" className="space-y-3 rounded-xl border border-amber-600 bg-amber-950/30 p-5 text-lg">
            <div className="font-semibold">{t("chat.terugval.titel")}</div>
            <p>{fallback && target?.structured ? t("chat.terugval.uitlegFout") : t("chat.terugval.uitleg", { ai: aiName })}</p>
            <button onClick={onOpenAdvanced} className="min-h-11 rounded-lg bg-indigo-600 px-5 font-medium hover:bg-indigo-500">
              {t("chat.technisch")}
            </button>
          </div>
        )}
        <div ref={end} />
      </div>

      <div role="status" aria-live="polite" data-testid="status-line" className="flex items-center gap-3 border-t border-zinc-800 px-5 py-2 text-base text-zinc-300">
        <span aria-hidden="true" className={busy ? "animate-pulse" : ""}>
          {busy ? "●" : "○"}
        </span>
        <span>{t(`chat.status.${busy ? status : status === "done" ? "done" : "idle"}`)}</span>
        {busy && (
          <button onClick={() => void chatStop(id)} className="ml-auto min-h-9 rounded-lg border border-zinc-600 px-3 text-sm hover:bg-zinc-800">
            {t("chat.stop")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 px-5 pb-2" aria-label={t("chat.snel.titel")}>
        {QUICK.map((k) => (
          <button
            key={k}
            disabled={!!unavailable}
            onClick={() => void send(t(`chat.snelPrompt.${k}`))}
            className="min-h-10 rounded-full border border-zinc-600 px-4 text-base hover:bg-zinc-800 disabled:opacity-40"
          >
            {t(`chat.snel.${k}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 px-4 pt-3">
        <div role="radiogroup" aria-label={t("chat.modus.label")} className="inline-flex overflow-hidden rounded-lg border border-zinc-600">
          {(["plan", "build"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              title={t(`chat.modus.${m}Uitleg`)}
              disabled={!!unavailable}
              onClick={() => void chooseMode(m)}
              className={`min-h-10 px-4 text-base ${mode === m ? "bg-indigo-700 font-semibold text-white" : "text-zinc-200 hover:bg-zinc-800"}`}
            >
              {t(`chat.modus.${m}`)}
            </button>
          ))}
        </div>
        {mode === "plan" && (
          <span data-testid="plan-banner" className="text-sm text-amber-200">
            {t("chat.modus.banner")}
          </span>
        )}
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-3 p-4">
        <label className="sr-only" htmlFor="chat-input">
          {t("chat.invoerLabel")}
        </label>
        <textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={!!unavailable}
          rows={3}
          placeholder={mode === "plan" ? t("chat.modus.placeholderPlan") : t("chat.placeholder")}
          className="min-h-24 flex-1 resize-y rounded-xl border border-zinc-600 bg-zinc-900 px-4 py-3 text-lg leading-relaxed placeholder:text-zinc-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!text.trim() || !!unavailable}
          className="min-h-12 rounded-xl bg-indigo-600 px-6 text-lg font-semibold hover:bg-indigo-500 disabled:opacity-40"
        >
          {t("chat.verstuur")}
        </button>
      </form>

      {asked && <PermissionDialog message={asked} technical={technical} onAnswer={(allow) => void permissionAnswer(id, asked.payload.req_id, allow).catch(fail)} />}
      {showVersions && <VersionsDialog projectId={id} onClose={() => setShowVersions(false)} onError={onError} />}
      {switching && <ChatSwitchDialog accounts={accounts} onCancel={() => setSwitching(false)} onPick={(p, a) => void switchTo(p, a)} />}
    </section>
  );
}

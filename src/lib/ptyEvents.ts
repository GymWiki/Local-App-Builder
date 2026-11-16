import { listen } from "@tauri-apps/api/event";

export interface OutputEv {
  id: string;
  data: string;
  end_offset: number;
}
export interface Handlers {
  output: (ev: OutputEv) => void;
  exit: (code: number | null) => void;
}

const registry = new Map<string, Handlers>();
let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= Promise.all([
    listen<OutputEv>("pty-output", (e) => registry.get(e.payload.id)?.output(e.payload)),
    listen<{ id: string; code: number | null }>("pty-exit", (e) => registry.get(e.payload.id)?.exit(e.payload.code)),
  ]).then(() => undefined);
  return ready;
}

/** Wacht tot de listeners staan voordat je een snapshot ophaalt, zodat er geen uitvoer tussendoor valt. */
export async function subscribe(id: string, h: Handlers): Promise<() => void> {
  registry.set(id, h);
  await init();
  return () => {
    if (registry.get(id) === h) registry.delete(id);
  };
}

export function decode(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

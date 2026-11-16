import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Runtime } from "./runtime.js";

/** Leest JSON-regels `{id, cmd, args}` van stdin en antwoordt met `{event:"reply", id, ok, result|error}`. */
export function attachControl(runtime: Runtime, input: Readable, emit: (o: object) => void): void {
  const rl = createInterface({ input });
  rl.on("line", (line) => {
    let msg: { id?: number; cmd?: string; args?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id !== "number" || typeof msg.cmd !== "string") return;
    const id = msg.id;
    runtime.control(msg.cmd, msg.args ?? {}).then(
      (result) => emit({ event: "reply", id, ok: true, result }),
      (e: Error) => emit({ event: "reply", id, ok: false, error: e.message }),
    );
  });
}

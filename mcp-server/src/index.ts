// Procesingang: configuratie via omgevingsvariabelen (zodat het token niet in `ps` staat).
// Protocol naar de app: één JSON-regel per gebeurtenis op stdout. Het token wordt nooit uitgeprint.
// Protocol van de app: JSON-regels op stdin (zie control.ts). Sluit stdin, dan ruimt dit proces alles op en stopt het.
import { attachControl } from "./control.js";
import { Runtime } from "./runtime.js";
import { startServer } from "./server.js";

const projectDir = process.env.STUDIO_PROJECT_DIR;
const projectName = process.env.STUDIO_PROJECT_NAME ?? "project";
const token = process.env.STUDIO_MCP_TOKEN;
delete process.env.STUDIO_MCP_TOKEN;

const emit = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");

if (!projectDir || !token) {
  emit({ event: "error", message: "STUDIO_PROJECT_DIR en STUDIO_MCP_TOKEN zijn verplicht." });
  process.exit(2);
}

const runtime = new Runtime({ projectDir, projectName, emit });
let clientSeen = false;
const running = await startServer({
  projectDir,
  projectName,
  token,
  runtime,
  onClient: () => {
    if (!clientSeen) {
      clientSeen = true;
      emit({ event: "client" });
    }
  },
  onToolCall: (r) => emit({ event: "tool", ...r }),
});
attachControl(runtime, process.stdin, emit);
emit({ event: "ready", port: running.port });

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(1), 8000); // harde bovengrens
  force.unref();
  void running
    .close()
    .then(() => runtime.close())
    .finally(() => process.exit(0));
};
process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.resume();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

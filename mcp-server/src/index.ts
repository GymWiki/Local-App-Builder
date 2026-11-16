// Procesingang: configuratie via omgevingsvariabelen (zodat het token niet in `ps` staat).
// Protocol naar de app: één JSON-regel per gebeurtenis op stdout. Het token wordt nooit uitgeprint.
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

let clientSeen = false;
const running = await startServer({
  projectDir,
  projectName,
  token,
  onClient: () => {
    if (!clientSeen) {
      clientSeen = true;
      emit({ event: "client" });
    }
  },
  onToolCall: (r) => emit({ event: "tool", ...r }),
});
emit({ event: "ready", port: running.port });

// Stopt zodra de app wegvalt of stdin sluit.
const stop = () => void running.close().then(() => process.exit(0));
process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.resume();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// Startpunt voor `npm run kit:validate`, `kit:test -- <id>` en `kit:schema`. De logica zit in mcp-server/src/kits/.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(process.execPath, [path.join(root, "mcp-server", "dist", "kits-cli.mjs"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, STUDIO_REPO_ROOT: root, STUDIO_BROWSER_PATH: process.env.STUDIO_BROWSER_PATH ?? "/opt/pw-browsers/chromium" },
});
process.exit(r.status ?? 1);

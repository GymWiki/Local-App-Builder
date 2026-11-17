// Zorgt dat mcp-server/ klaar is: dependencies geïnstalleerd en dist/index.mjs gebouwd.
// Wordt aangeroepen door `npm run mcp:build`, en dus automatisch door `npm run tauri dev` en de release-build.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "mcp-server");
const out = path.join(dir, "dist", "index.mjs");

function die(msg) {
  console.error(`\n[mcp-server] FOUT: ${msg}\n`);
  process.exit(1);
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) die(`Node.js ${process.versions.node} is te oud; Studio vraagt Node.js 20 of nieuwer (https://nodejs.org).`);

// npm via zijn eigen JS-bestand starten werkt op elk platform (op Windows is `npm` een .cmd-shim).
function npm(args) {
  const cli = process.env.npm_execpath;
  const r =
    cli && cli.endsWith(".js")
      ? spawnSync(process.execPath, [cli, ...args], { cwd: dir, stdio: "inherit" })
      : spawnSync("npm", args, { cwd: dir, stdio: "inherit", shell: true });
  if (r.error) die(`npm kon niet worden gestart: ${r.error.message}`);
  if (r.status !== 0) die(`'npm ${args.join(" ")}' in mcp-server/ mislukte (exitcode ${r.status}).`);
}

if (!existsSync(path.join(dir, "package.json"))) die(`${dir} bevat geen package.json.`);
if (!existsSync(path.join(dir, "node_modules", "esbuild")) || !existsSync(path.join(dir, "node_modules", "@modelcontextprotocol"))) {
  console.log("[mcp-server] dependencies ontbreken: npm install…");
  npm(["install", "--no-audit", "--no-fund"]);
}
console.log("[mcp-server] bouwen…");
npm(["run", "build"]);

if (!existsSync(out)) die(`de build leverde ${out} niet op.`);
console.log(`[mcp-server] klaar: ${out} (${Math.round(statSync(out).size / 1024)} kB)`);

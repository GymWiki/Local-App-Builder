// Eenmalig instellen van het bijwerken van Studio: maakt een sleutelpaar, zet de PUBLIEKE sleutel in tauri.conf.json
// en zet (als de GitHub CLI `gh` is ingelogd) de PRIVÉSLEUTEL als geheim in GitHub. De privésleutel gaat nooit in de repository.
// Gebruik: npm run setup:updates
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conf = path.join(root, "src-tauri", "tauri.conf.json");
const REPO = "GymWiki/Local-App-Builder";
const dir = path.join(homedir(), ".tauri");
const key = path.join(dir, "studio.key");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

mkdirSync(dir, { recursive: true });
if (existsSync(key)) {
  console.log(`Bestaand sleutelpaar gevonden: ${key} (wordt hergebruikt).`);
} else {
  const r = spawnSync(npx, ["tauri", "signer", "generate", "--ci", "-p", "", "-w", key], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0 || !existsSync(`${key}.pub`)) {
    console.error("FOUT: het sleutelpaar kon niet worden gemaakt.");
    process.exit(1);
  }
  console.log(`Sleutelpaar gemaakt in ${dir}. BEWAAR het bestand ${key} veilig: zonder dit bestand kun je geen updates meer uitgeven.`);
}

const pub = readFileSync(`${key}.pub`, "utf8").trim();
const cfg = JSON.parse(readFileSync(conf, "utf8"));
cfg.plugins.updater.pubkey = pub;
writeFileSync(conf, JSON.stringify(cfg, null, 2) + "\n");
console.log("De publieke sleutel staat nu in src-tauri/tauri.conf.json. Commit en push dat bestand.");

let gezet = false;
try {
  execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
  const r = spawnSync("gh", ["secret", "set", "TAURI_SIGNING_PRIVATE_KEY", "--repo", REPO], { input: readFileSync(key), stdio: ["pipe", "inherit", "inherit"] });
  gezet = r.status === 0;
} catch {
  /* gh niet beschikbaar of niet ingelogd */
}
if (gezet) console.log("De privésleutel is als geheim TAURI_SIGNING_PRIVATE_KEY in GitHub gezet.");
else {
  console.log(`
Zet nu zelf de privésleutel in GitHub (eenmalig):
  1. Open https://github.com/${REPO}/settings/secrets/actions/new
  2. Naam: TAURI_SIGNING_PRIVATE_KEY
  3. Waarde: de volledige inhoud van het bestand ${key}
     (Windows PowerShell: Get-Content "${key}" -Raw | Set-Clipboard   — daarna plakken)
Er is geen wachtwoord ingesteld, dus een geheim voor het wachtwoord is niet nodig.`);
}

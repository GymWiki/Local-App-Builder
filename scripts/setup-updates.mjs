// Eenmalig instellen van het bijwerken van Studio: maakt een sleutelpaar (met een wachtwoord naar keuze), zet de PUBLIEKE sleutel in
// tauri.conf.json en zet (als de GitHub CLI `gh` is ingelogd) de PRIVÉSLEUTEL en het wachtwoord als geheim in GitHub.
// Niets geheims gaat op een commandoregel: het wachtwoord gaat alleen via een omgevingsvariabele of stdin naar een ander programma.
// Gebruik: npm run setup:updates
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const confPad = path.join(root, "src-tauri", "tauri.conf.json");
const REPO = "GymWiki/Local-App-Builder";
const SLEUTEL_GEHEIM = "TAURI_SIGNING_PRIVATE_KEY";
const WACHTWOORD_GEHEIM = "TAURI_SIGNING_PRIVATE_KEY_PASSWORD";
const MIN_LENGTE = 8;
const dir = path.join(homedir(), ".tauri");
const sleutel = path.join(dir, "studio.key");
const publiek = `${sleutel}.pub`;
const iswin = process.platform === "win32";

// Het sleutelprogramma van Tauri rechtstreeks met Node starten: geen shell, dus geen problemen met spaties of aanhalingstekens
// in paden en geen lege argumenten die Windows weggooit.
const tauriJs = path.join(path.dirname(createRequire(import.meta.url).resolve("@tauri-apps/cli/package.json")), "tauri.js");
function tauri(args, { env = {}, interactief = false, input } = {}) {
  const r = spawnSync(process.execPath, [tauriJs, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    stdio: interactief ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  return { ok: r.status === 0, uit: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), fout: r.error ? String(r.error.message) : "" };
}

function stop(bericht) {
  console.error(`\nFOUT: ${bericht}`);
  process.exit(1);
}

// ---------------------------------------------------------------- invoer
if (!process.stdin.isTTY) stop("Start dit script in een gewone terminal (PowerShell of Terminal), niet via een pijp of een editor.");

function lees(vraag, { verborgen = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(vraag);
    let tekst = "";
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const klaar = (waarde) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", op);
      process.stdout.write("\n");
      resolve(waarde);
    };
    const op = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") return klaar(tekst);
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") tekst = tekst.slice(0, -1);
        else if (c >= " ") {
          tekst += c;
          if (!verborgen) process.stdout.write(c);
        }
      }
    };
    stdin.on("data", op);
  });
}
const jaNee = async (vraag, standaardJa = true) => {
  const a = (await lees(`${vraag} ${standaardJa ? "[J/n]" : "[j/N]"} `)).trim().toLowerCase();
  return a === "" ? standaardJa : ["j", "ja", "y", "yes"].includes(a);
};

async function nieuwWachtwoord() {
  for (;;) {
    const a = await lees(`Kies een wachtwoord (minstens ${MIN_LENGTE} tekens, je ziet niets terwijl je typt): `, { verborgen: true });
    if (a.length < MIN_LENGTE) {
      console.log(`Te kort: minstens ${MIN_LENGTE} tekens.`);
      continue;
    }
    const b = await lees("Typ het wachtwoord nog een keer: ", { verborgen: true });
    if (a !== b) {
      console.log("De twee wachtwoorden zijn niet gelijk. Probeer opnieuw.");
      continue;
    }
    return a;
  }
}

// Controleert of een wachtwoord (leeg = geen wachtwoord) bij de sleutel past, door een tijdelijk bestand te ondertekenen.
// Het wachtwoord gaat via een omgevingsvariabele, niet via de commandoregel.
function past(wachtwoord) {
  const tmp = mkdtempSync(path.join(tmpdir(), "studio-sleutel-"));
  try {
    const f = path.join(tmp, "controle.txt");
    writeFileSync(f, "controle");
    return tauri(["signer", "sign", "-f", sleutel, f], { env: { [WACHTWOORD_GEHEIM]: wachtwoord } }).ok;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- sleutel maken of hergebruiken
mkdirSync(dir, { recursive: true });
let wachtwoord = "";

if (existsSync(sleutel)) {
  console.log(`Er bestaat al een sleutel: ${sleutel}`);
  console.log("Een NIEUWE sleutel maakt het onmogelijk om mensen met een eerder geïnstalleerde versie nog bij te werken: zij moeten dan opnieuw downloaden.");
  if (await jaNee("Wil je deze bestaande sleutel gebruiken?", true)) {
    if (!past("")) {
      let gelukt = false;
      for (let i = 0; i < 3 && !gelukt; i++) {
        wachtwoord = await lees("Dit is het wachtwoord van de sleutel (je ziet niets terwijl je typt): ", { verborgen: true });
        gelukt = past(wachtwoord);
        if (!gelukt) console.log("Dat wachtwoord klopt niet.");
      }
      if (!gelukt) stop("Het wachtwoord klopt niet. De sleutel is niet gewijzigd.");
    }
  } else {
    const zeker = await lees('Typ precies "JA, NIEUWE SLEUTEL" als je zeker weet dat je een nieuwe sleutel wilt: ');
    if (zeker.trim() !== "JA, NIEUWE SLEUTEL") stop("Afgebroken. Er is niets gewijzigd.");
    const stempel = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(sleutel, `${sleutel}.oud-${stempel}`);
    if (existsSync(publiek)) renameSync(publiek, `${publiek}.oud-${stempel}`);
    console.log(`De oude sleutel is bewaard als ${sleutel}.oud-${stempel} (niets is verwijderd).`);
  }
}

if (!existsSync(sleutel)) {
  const metWachtwoord = await jaNee("Wil je de sleutel met een wachtwoord beveiligen? (aanbevolen)", true);
  if (metWachtwoord) {
    for (let poging = 0; poging < 3; poging++) {
      wachtwoord = await nieuwWachtwoord();
      console.log("\nStraks vraagt het sleutelprogramma om een wachtwoord. Typ daar HETZELFDE wachtwoord.\n");
      const r = tauri(["signer", "generate", "-w", sleutel], { interactief: true });
      if (!r.ok || !existsSync(sleutel) || !existsSync(publiek)) stop(`het sleutelpaar kon niet worden gemaakt.${r.fout ? ` ${r.fout}` : ""}`);
      if (past(wachtwoord)) break;
      // Een typefout bij het sleutelprogramma: de net gemaakte (nog ongebruikte) sleutel weggooien en opnieuw.
      rmSync(sleutel, { force: true });
      rmSync(publiek, { force: true });
      console.log("\nHet wachtwoord dat je bij het sleutelprogramma typte, was niet gelijk aan dat van zojuist. Opnieuw beginnen.\n");
      wachtwoord = "";
    }
    if (!existsSync(sleutel)) stop("het wachtwoord is drie keer niet gelijk ingevoerd. Probeer het later opnieuw.");
  } else {
    // Zonder wachtwoord: alleen --ci en géén wachtwoordoptie (een leeg argument wordt op Windows niet doorgegeven).
    const r = tauri(["signer", "generate", "--ci", "-w", sleutel]);
    if (!r.ok || !existsSync(sleutel) || !existsSync(publiek)) stop(`het sleutelpaar kon niet worden gemaakt.\n${r.uit}${r.fout}`);
  }
  console.log(`Sleutelpaar gemaakt in ${dir}.`);
}

// ---------------------------------------------------------------- publieke sleutel in de configuratie
const pub = readFileSync(publiek, "utf8").trim();
const cfg = JSON.parse(readFileSync(confPad, "utf8"));
cfg.plugins.updater.pubkey = pub;
writeFileSync(confPad, JSON.stringify(cfg, null, 2) + "\n");
console.log("De publieke sleutel staat nu in src-tauri/tauri.conf.json. Commit en push dat bestand.");

// ---------------------------------------------------------------- geheimen in GitHub
function gh(args, input) {
  const r = spawnSync("gh", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: false });
  return { ok: r.status === 0, uit: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}
const ghKlaar = gh(["auth", "status"]).ok;
let sleutelGezet = false;
let wachtwoordGezet = false;
if (ghKlaar) {
  sleutelGezet = gh(["secret", "set", SLEUTEL_GEHEIM, "--repo", REPO], readFileSync(sleutel)).ok;
  if (wachtwoord) wachtwoordGezet = gh(["secret", "set", WACHTWOORD_GEHEIM, "--repo", REPO], wachtwoord).ok;
  else gh(["secret", "delete", WACHTWOORD_GEHEIM, "--repo", REPO]); // geen wachtwoord: een oud geheim zou het ondertekenen laten mislukken
}
console.log("");
if (sleutelGezet) console.log(`Gedaan: de privésleutel staat als geheim ${SLEUTEL_GEHEIM} in GitHub.`);
else
  console.log(`Doe nu zelf (eenmalig): open https://github.com/${REPO}/settings/secrets/actions/new
  - Naam: ${SLEUTEL_GEHEIM}
  - Waarde: de volledige inhoud van ${sleutel}
    ${iswin ? `(PowerShell: Get-Content -Raw -LiteralPath "${sleutel}" | Set-Clipboard   en dan plakken)` : `(bijvoorbeeld: cat "${sleutel}")`}`);
if (wachtwoord) {
  if (wachtwoordGezet) console.log(`Gedaan: het wachtwoord staat als geheim ${WACHTWOORD_GEHEIM} in GitHub.`);
  else
    console.log(`Doe ook dit (eenmalig): open https://github.com/${REPO}/settings/secrets/actions/new
  - Naam: ${WACHTWOORD_GEHEIM}
  - Waarde: het wachtwoord dat je net hebt gekozen`);
} else {
  console.log(`Er is geen wachtwoord gekozen, dus het geheim ${WACHTWOORD_GEHEIM} is niet nodig.`);
}

console.log(`
============================ BELANGRIJK ============================
Bewaar dit veilig (bijvoorbeeld in een wachtwoordmanager en een back-up):
  1. het bestand ${sleutel}
${wachtwoord ? "  2. het wachtwoord dat je hebt gekozen\n" : ""}Raak je ${wachtwoord ? "een van beide" : "dit bestand"} kwijt, dan kun je geen updates meer uitgeven. Mensen die Studio al hebben,
moeten dan opnieuw downloaden. Zet de sleutel ${wachtwoord ? "en het wachtwoord " : ""}NOOIT in de repository of in een bericht.
====================================================================
Volgende stap: commit en push src-tauri/tauri.conf.json (git add src-tauri/tauri.conf.json; git commit -m "Publieke sleutel voor updates"; git push).`);

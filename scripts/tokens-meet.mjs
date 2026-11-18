// Meetinstrument voor het AI-gebruik van Studio (docs/tokens.md).
//   node scripts/tokens-meet.mjs statisch            de vaste context die elke taak meeneemt (geschat: tekens/4)
//   node scripts/tokens-meet.mjs parse <bestand...>  cijfers uit opgenomen stream-json-uitvoer (Claude of Gemini)
//   STUDIO_BENCH_OK=1 node scripts/tokens-meet.mjs live <label> [taak-id]
//        draait de taken echt met `claude -p` op kopieën van de startprojecten en bewaart de uitvoer in docs/tokens-opnames/.
//        Dit verbruikt AI-gebruik van het ingelogde account; daarom alleen met STUDIO_BENCH_OK=1.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("mcp-server/package.json"));
const esbuild = require("esbuild");
const uit = path.join(mkdtempSync(path.join(tmpdir(), "tokens-")), "gebruik.mjs");
esbuild.buildSync({ entryPoints: ["mcp-server/src/gebruik.ts"], bundle: true, format: "esm", platform: "node", outfile: uit, logLevel: "silent" });
const { parseClaudeStream, parseGeminiStream, totaalVerwerkt } = await import(pathToUrl(uit));
function pathToUrl(p) { return new URL("file://" + (p.startsWith("/") ? "" : "/") + p.replaceAll("\\", "/")).href; }

const schat = (tekst) => Math.ceil(tekst.length / 4);
const taken = JSON.parse(readFileSync("scripts/tokens-taken.json", "utf8")).taken;
const [, , cmd = "statisch", ...rest] = process.argv;

function statisch() {
  const rijen = [];
  const voeg = (naam, tekst) => rijen.push({ naam, tekens: tekst.length, tokens: schat(tekst) });
  for (const d of readdirSync("skills", { withFileTypes: true })) {
    const f = path.join("skills", d.name, "instructions.md");
    if (d.isDirectory() && existsSync(f)) voeg(`instructieblok ${d.name}`, readFileSync(f, "utf8"));
  }
  for (const d of readdirSync("templates", { withFileTypes: true })) {
    const f = path.join("templates", d.name, "PROJECT.md");
    if (d.isDirectory() && existsSync(f)) voeg(`PROJECT.md ${d.name}`, readFileSync(f, "utf8"));
  }
  const tools = readFileSync("mcp-server/src/tools.ts", "utf8");
  const beschr = [...tools.matchAll(/description:\s*(?:\n\s*)?(["`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map((m) => m[2]);
  voeg(`MCP-tool-beschrijvingen (${beschr.length} stuks, alleen de tekst)`, beschr.join("\n"));
  console.table(rijen);
  const alles = rijen.filter((r) => !r.naam.startsWith("PROJECT.md")).reduce((a, r) => a + r.tokens, 0);
  console.log(`Vaste Studio-context per taak, geschat: ± ${alles} tokens (+ één PROJECT.md). Dit is een schatting (tekens/4), geen CLI-cijfer.`);
}

function parse(bestanden) {
  const rijen = bestanden.map((f) => {
    const t = readFileSync(f, "utf8");
    const g = /"type":\s*"result"[^\n]*"stats"/.test(t) ? parseGeminiStream(t) : parseClaudeStream(t);
    return { bestand: path.basename(f), cli: g.cli, bron: g.bron, invoer: g.invoer, uitvoer: g.uitvoer, cacheLees: g.cacheGelezen, cacheSchrijf: g.cacheGeschreven, tools: g.toolAanroepen, bestanden: g.bestandenGelezen, beurten: g.beurten, sec: g.duurMs == null ? null : Math.round(g.duurMs / 100) / 10, usd: g.kostenUsd, ok: g.geslaagd, totaal: totaalVerwerkt(g) };
  });
  console.table(rijen);
  return rijen;
}

function live(label, alleen) {
  if (process.env.STUDIO_BENCH_OK !== "1") {
    console.error("Dit start de AI echt en verbruikt gebruik van het ingelogde account. Zet STUDIO_BENCH_OK=1 om door te gaan.");
    process.exit(2);
  }
  if (!label) { console.error("Geef een label, bijvoorbeeld: nulmeting"); process.exit(2); }
  const map = path.join("docs", "tokens-opnames", label);
  mkdirSync(map, { recursive: true });
  for (const t of taken.filter((x) => !alleen || x.id === alleen)) {
    const werk = mkdtempSync(path.join(tmpdir(), `bench-${t.id}-`));
    cpSync(path.join("templates", t.project), werk, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: werk });
    spawnSync("git", ["add", "-A"], { cwd: werk });
    spawnSync("git", ["-c", "user.name=bench", "-c", "user.email=b@b", "commit", "-qm", "start"], { cwd: werk });
    const r = spawnSync("claude", ["-p", t.prompt, "--output-format", "stream-json", "--verbose", "--max-turns", "25", "--permission-mode", "acceptEdits"], { cwd: werk, encoding: "utf8", timeout: 600000 });
    const bestand = path.join(map, `${t.id}.jsonl`);
    writeFileSync(bestand, r.stdout ?? "");
    const diff = spawnSync("git", ["status", "--porcelain"], { cwd: werk, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).length;
    console.log(`${t.id}: ${diff} gewijzigde bestanden (kwaliteit: bekijk handmatig → ${t.kwaliteit.join("; ")})`);
  }
  parse(readdirSync(map).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(map, f)));
}

if (cmd === "statisch") statisch();
else if (cmd === "parse") parse(rest);
else if (cmd === "live") live(rest[0], rest[1]);
else console.error("Gebruik: statisch | parse <bestand...> | live <label> [taak]");

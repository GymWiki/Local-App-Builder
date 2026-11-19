import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type SecurityCode = "api_key" | "private_key" | "env_in_git" | "secret_file_in_git" | "secret_in_export" | "password" | "db_rules_missing" | "db_rules_open";

export interface SecurityFinding {
  code: SecurityCode;
  severity: "hoog" | "midden";
  file: string;
  line?: number;
  /** Veilige omschrijving: geheimen staan hier nooit volledig. */
  detail: string;
}

export interface SecurityReport {
  scanned: number;
  findings: SecurityFinding[];
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".studio", "target", ".dart_tool", ".gradle", "coverage", "__pycache__", "venv", ".venv", ".idea"]);
/** Uitvoermappen: wat hierin staat, komt bij publiceren op internet. */
const EXPORT_DIRS = ["dist", "build", "out", "public"];
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|html?|css|scss|vue|svelte|astro|php|py|rb|go|rs|java|kt|dart|swift|ya?ml|toml|ini|cfg|conf|md|txt|sh|sql|env|gradle|properties|xml|rules)$/i;
const MAX_FILE = 600_000;
const MAX_FILES = 3000;

const SECRET_FILE = (rel: string): boolean => {
  const name = rel.toLowerCase().split("/").pop() ?? "";
  if ([".env.example", ".env.sample", ".env.template"].includes(name)) return false;
  return name === ".env" || name.startsWith(".env.") || /\.(pem|key|p12|pfx|keystore|jks)$/.test(name) || /^id_(rsa|ed25519|ecdsa)/.test(name) || name === ".npmrc" || name === ".netrc" || name === "credentials.json" || name === "service-account.json";
};

const KEY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, label: "Anthropic-sleutel" },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g, label: "API-sleutel (sk-…)" },
  { re: /\bsk_live_[A-Za-z0-9]{16,}/g, label: "Stripe-sleutel (live)" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, label: "GitHub-token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS-sleutel" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: "Slack-token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: "Google-sleutel" },
  { re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g, label: "Supabase geheime sleutel" },
  { re: /\bsbp_[A-Za-z0-9]{30,}/g, label: "Supabase toegangstoken" },
  { re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g, label: "JWT-token" },
];
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/;
const GENERIC_KEY = /\b(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([A-Za-z0-9_\-+/=]{16,})["']/gi;
const PASSWORD = /\b(?:password|passwd|pwd|wachtwoord)\b["']?\s*[:=]\s*["']([^"'\s]{4,})["']/gi;
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|your[_-]|<|\$\{|process\.env|changeme|change[_-]me|example|voorbeeld|placeholder|test|password|wachtwoord|secret|todo|dummy|\.{3})/i;

/** Maskeert een geheim: de eerste vier tekens en sterretjes. */
export function mask(v: string): string {
  return `${v.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, v.length - 4)))}`;
}

const isPlaceholder = (v: string) => PLACEHOLDER.test(v) || /^(.)\1+$/.test(v) || /^[A-Za-z]+$/.test(v) && v.length < 20;

export function scanText(rel: string, text: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const isTest = /(?:^|\/)(?:tests?|__tests__|fixtures?|mocks?)\/|\.(?:test|spec)\.[a-z]+$/i.test(rel);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line.length > 4000) return;
    for (const p of KEY_PATTERNS) for (const m of line.matchAll(p.re)) out.push({ code: "api_key", severity: "hoog", file: rel, line: i + 1, detail: `${p.label}: ${mask(m[0])}` });
    // Een JWT met de rol "service_role" is de geheime Supabase-sleutel (de "anon"-sleutel is openbaar en mag wel in de app).
    for (const m of line.matchAll(/\beyJ[A-Za-z0-9_-]{15,}\.(eyJ[A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}/g)) {
      try {
        if ((JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as { role?: string }).role === "service_role") out.push({ code: "api_key", severity: "hoog", file: rel, line: i + 1, detail: `Supabase service-sleutel (geheim): ${mask(m[0])}` });
      } catch {
        /* geen leesbare JWT: de gewone controle hierboven geldt */
      }
    }
    // Een geheime sleutel met een naam die de browser te zien krijgt (VITE_ of NEXT_PUBLIC_) lekt altijd.
    if (/\b(?:VITE|NEXT_PUBLIC|PUBLIC|REACT_APP)_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET)[A-Z0-9_]*\b/.test(line) && !isTest) out.push({ code: "api_key", severity: "hoog", file: rel, line: i + 1, detail: "Een geheime sleutel met een openbare naam: de browser krijgt hem te zien." });
    if (PRIVATE_KEY.test(line)) out.push({ code: "private_key", severity: "hoog", file: rel, line: i + 1, detail: "Een privésleutel staat in dit bestand." });
    for (const m of line.matchAll(GENERIC_KEY)) if (!isPlaceholder(m[1])) out.push({ code: "api_key", severity: "hoog", file: rel, line: i + 1, detail: `Geheim in de code: ${mask(m[1])}` });
    if (!isTest) for (const m of line.matchAll(PASSWORD)) if (!isPlaceholder(m[1])) out.push({ code: "password", severity: "midden", file: rel, line: i + 1, detail: `Vast wachtwoord in de code: ${mask(m[1])}` });
  });
  return out;
}

async function walk(root: string, sub: string, out: string[], depth = 0): Promise<void> {
  if (depth > 10 || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(path.join(root, sub), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(root, rel, out, depth + 1);
    } else if (out.length < MAX_FILES) out.push(rel);
  }
}

async function gitFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["ls-files", "-z"], { cwd: root, timeout: 15_000, maxBuffer: 10_000_000, windowsHide: true });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** Tabellen met `create table` zonder `enable row level security` in Supabase-SQL. */
export function missingRls(sql: string): string[] {
  const clean = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const created = [...clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)].map((m) => m[1].replace(/"/g, "").replace(/^public\./i, ""));
  const secured = new Set([...clean.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s+enable\s+row\s+level\s+security/gi)].map((m) => m[1].replace(/"/g, "").replace(/^public\./i, "")));
  return created.filter((t) => !secured.has(t) && !/^(?:auth|storage|extensions|realtime)\./i.test(t));
}

export async function securityCheck(projectDir: string): Promise<SecurityReport> {
  const files: string[] = [];
  await walk(projectDir, "", files);
  const findings: SecurityFinding[] = [];
  let scanned = 0;

  const tracked = await gitFiles(projectDir);
  for (const f of tracked) {
    if (!SECRET_FILE(f)) continue;
    const name = f.toLowerCase().split("/").pop() ?? "";
    findings.push({ code: name === ".env" || name.startsWith(".env.") ? "env_in_git" : "secret_file_in_git", severity: "hoog", file: f, detail: "Dit bestand zit in de versiegeschiedenis (git)." });
  }

  for (const rel of files) {
    const inExport = EXPORT_DIRS.includes(rel.split("/")[0]);
    if (inExport && SECRET_FILE(rel)) findings.push({ code: "secret_in_export", severity: "hoog", file: rel, detail: "Dit geheime bestand staat in een map die online komt." });
    if (!TEXT_EXT.test(rel) || SECRET_FILE(rel) && !/\.env/.test(rel)) continue;
    let st;
    try {
      st = await stat(path.join(projectDir, rel));
    } catch {
      continue;
    }
    if (st.size > MAX_FILE || !st.isFile()) continue;
    const text = await readFile(path.join(projectDir, rel), "utf8").catch(() => null);
    if (text === null) continue;
    scanned++;
    // Een .env zelf bevat per definitie geheimen; die worden alleen gemeld als hij in git zit (zie boven).
    if (/(?:^|\/)\.env(?:\.|$)/.test(rel)) continue;
    for (const f of scanText(rel, text)) findings.push(inExport ? { ...f, code: f.code === "api_key" || f.code === "private_key" ? "secret_in_export" : f.code, detail: `${f.detail} (in een map die online komt)` } : f);
    const lower = rel.toLowerCase();
    if (/(?:^|\/)supabase\/.*\.sql$/.test(lower)) {
      for (const t of missingRls(text)) findings.push({ code: "db_rules_missing", severity: "hoog", file: rel, detail: `De tabel ‘${t}’ heeft geen toegangsregels (row level security).` });
    }
    if (/(?:^|\/)(?:firestore|storage)\.rules$/.test(lower) && /allow\s+[a-z, ]+:\s*if\s+true/i.test(text)) findings.push({ code: "db_rules_open", severity: "hoog", file: rel, detail: "De regels laten iedereen lezen of schrijven (‘if true’)." });
    if (/(?:^|\/)database\.rules\.json$/.test(lower) && /"\.(?:read|write)"\s*:\s*(?:true|"true")/.test(text)) findings.push({ code: "db_rules_open", severity: "hoog", file: rel, detail: "De regels laten iedereen lezen of schrijven." });
  }
  // Dubbelen weg (dezelfde melding op dezelfde plek) en de ernstigste eerst.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const k = f.line ? `${f.code}|${f.file}|${f.line}` : `${f.code}|${f.file}|${f.detail}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  unique.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "hoog" ? -1 : 1) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { scanned, findings: unique };
}

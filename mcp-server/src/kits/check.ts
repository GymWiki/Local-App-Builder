import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { scanSource, SCAN_EXT, SKIP, RULE_TITLES } from "../../../design-packs/_tools/kit-scan.mjs";
import type { ScanFinding, ScanConfig } from "../../../design-packs/_tools/kit-scan.mjs";

export type { ScanFinding };
export const RULES = RULE_TITLES as Record<string, string>;

export type Strengheid = "waarschuwen" | "blokkeren";
export interface KitCheckConfig extends ScanConfig {
  strengheid: Strengheid;
}

export interface KitCheckResult {
  /** Is er een kit-check ingesteld voor dit project? */
  enabled: boolean;
  strengheid: Strengheid;
  scanned: number;
  findings: ScanFinding[];
}

const MAX_FILES = 2000;
const MAX_BYTES = 500_000;

export async function loadCheckConfig(projectDir: string): Promise<KitCheckConfig | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(projectDir, "design", "kit-check.json"), "utf8")) as Partial<KitCheckConfig>;
    return {
      strengheid: raw.strengheid === "blokkeren" ? "blokkeren" : "waarschuwen",
      vervangNative: raw.vervangNative ?? {},
      verbodenImports: raw.verbodenImports ?? [],
    };
  } catch {
    return null;
  }
}

async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 10 || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (e.isSymbolicLink() || e.name.startsWith(".") || SKIP.test(rel + (e.isDirectory() ? "/" : ""))) continue;
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (SCAN_EXT.test(e.name)) out.push(full);
    }
  }
  await walk(path.join(root, "src"), 0);
  return out;
}

/** Scant de broncode in src/ op dingen die niet bij de kit passen. */
export async function checkProject(projectDir: string): Promise<KitCheckResult> {
  const cfg = await loadCheckConfig(projectDir);
  if (!cfg) return { enabled: false, strengheid: "waarschuwen", scanned: 0, findings: [] };
  const findings: ScanFinding[] = [];
  let scanned = 0;
  for (const f of await files(projectDir)) {
    const st = await stat(f);
    if (st.size > MAX_BYTES) continue;
    scanned++;
    findings.push(...scanSource(path.relative(projectDir, f).split(path.sep).join("/"), await readFile(f, "utf8"), cfg));
  }
  return { enabled: true, strengheid: cfg.strengheid, scanned, findings };
}

/** Stelt in of de kit-check alleen waarschuwt of ook blokkeert (zet het in design/kit-check.json). */
export async function setStrictness(projectDir: string, level: Strengheid): Promise<{ strengheid: Strengheid }> {
  const file = path.join(projectDir, "design", "kit-check.json");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Dit project heeft nog geen uiterlijk gekozen.");
  }
  await writeFile(file, JSON.stringify({ ...raw, strengheid: level }, null, 2) + "\n");
  return { strengheid: level };
}

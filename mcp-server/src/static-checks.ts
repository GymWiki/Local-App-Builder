import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PathError, resolveInside } from "./paths.js";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "coverage", "__pycache__", "venv"]);
const MAX_HTML_FILES = 200;
const MAX_HTML_BYTES = 1_000_000;
const MAX_REPORT = 50;

export interface CheckOutcome {
  ok: boolean;
  /** Foutregels (leeg bij geslaagd). */
  lines: string[];
  skipped?: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Is het entry-bestand er en bevat het HTML? */
export async function checkHtml(root: string, entry: string): Promise<CheckOutcome> {
  const file = await resolveInside(root, entry).catch(() => null);
  if (!file || !(await exists(file))) return { ok: false, lines: [`${entry} ontbreekt in ${root}.`] };
  const body = await readFile(file, "utf8");
  if (!body.trim()) return { ok: false, lines: [`${entry} is leeg.`] };
  if (!/<(!doctype|html|head|body|main|div|section|h1|p)\b/i.test(body)) return { ok: false, lines: [`${entry} bevat geen herkenbare HTML-tags.`] };
  return { ok: true, lines: [] };
}

async function htmlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8 || out.length >= MAX_HTML_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (/\.html?$/i.test(e.name) && out.length < MAX_HTML_FILES) out.push(p);
    }
  }
  await walk(root, 0);
  return out;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // http:, https:, mailto:, tel:, data:, javascript:, //cdn…

/** Alle lokale href/src-verwijzingen in de HTML-bestanden moeten naar een bestaand bestand wijzen (zoals de statische server ze zou serveren). */
export async function checkLinks(root: string): Promise<CheckOutcome> {
  const broken: string[] = [];
  const files = await htmlFiles(root);
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const st = await stat(file);
    if (st.size > MAX_HTML_BYTES) continue;
    const html = await readFile(file, "utf8");
    const re = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    for (let m: RegExpExecArray | null; (m = re.exec(html)); ) {
      const raw = (m[1] ?? m[2] ?? "").trim();
      if (!raw || raw.startsWith("#") || EXTERNAL.test(raw) || /\{\{|\$\{|<%/.test(raw)) continue;
      let target = raw.split(/[?#]/)[0];
      try {
        target = decodeURIComponent(target);
      } catch {
        /* laat zoals het is */
      }
      const abs = target.startsWith("/") ? path.join(root, target) : path.join(path.dirname(file), target);
      const relToRoot = path.relative(root, abs);
      let resolved: string | null = null;
      try {
        let candidate = relToRoot === "" || target.endsWith("/") ? path.join(relToRoot, "index.html") : relToRoot;
        const isDir = await stat(path.join(root, relToRoot)).then((s) => s.isDirectory()).catch(() => false);
        if (isDir) candidate = path.join(relToRoot, "index.html");
        resolved = await resolveInside(root, candidate);
      } catch (e) {
        if (!(e instanceof PathError)) throw e;
        broken.push(`${rel}: "${raw}" wijst buiten de projectmap`);
        continue;
      }
      if (!(await exists(resolved))) broken.push(`${rel}: "${raw}" bestaat niet`);
    }
  }
  const lines = broken.slice(0, MAX_REPORT);
  if (broken.length > MAX_REPORT) lines.push(`… en ${broken.length - MAX_REPORT} meer`);
  return { ok: broken.length === 0, lines };
}

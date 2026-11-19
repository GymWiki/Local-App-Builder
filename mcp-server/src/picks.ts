import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PICKS_DIR = ".studio/picks";
const KEEP = 30;

/** Zorgt dat .studio/ nooit in git terechtkomt, zonder het .gitignore van de gebruiker te wijzigen (.git/info/exclude is lokaal). */
export async function ensureExcluded(projectDir: string): Promise<void> {
  const info = path.join(projectDir, ".git", "info");
  if (!existsSync(path.join(projectDir, ".git"))) return;
  await mkdir(info, { recursive: true });
  const file = path.join(info, "exclude");
  const cur = existsSync(file) ? await readFile(file, "utf8") : "";
  if (!cur.split("\n").some((l) => l.trim() === ".studio/")) await appendFile(file, `${cur && !cur.endsWith("\n") ? "\n" : ""}.studio/\n`);
}

/** Bewaart een schermafbeelding van een gekozen onderdeel in .studio/picks/ (nooit in de projectbestanden zelf). Geeft het relatieve pad terug. */
export async function writePick(projectDir: string, jpeg: Buffer): Promise<string> {
  const dir = path.join(projectDir, PICKS_DIR);
  await mkdir(dir, { recursive: true });
  await ensureExcluded(projectDir);
  const name = `pick-${Date.now()}.jpg`;
  await writeFile(path.join(dir, name), jpeg);
  // Oude opruimen: alleen onze eigen bestanden.
  const all = (await readdir(dir)).filter((f) => /^pick-\d+\.jpg$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await rm(path.join(dir, old), { force: true });
  return `${PICKS_DIR}/${name}`;
}

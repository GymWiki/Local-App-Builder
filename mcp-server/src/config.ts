import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolveInside } from "./paths.js";

export const CONFIG_FILE = "studio.json";
const MAX_BYTES = 64 * 1024;

export interface StudioConfig {
  dev?: string;
  build?: string;
  lint?: string;
  test?: string;
  previewUrl?: string;
  /** Time-out per check-stap in seconden (standaard 300). */
  timeoutSec?: number;
}

export interface LoadedConfig {
  exists: boolean;
  config: StudioConfig | null;
  /** sha256 van de ruwe bestandsinhoud: wijzigt het bestand, dan vervalt het vertrouwen. */
  hash: string | null;
  error?: string;
}

export const STARTER_CONFIG: StudioConfig = {
  dev: "npm run dev",
  build: "npm run build",
  lint: "npm run lint",
  test: "npm test",
  previewUrl: "http://localhost:5173",
};

const COMMAND_KEYS = ["dev", "build", "lint", "test"] as const;

/** Alleen loopback: de preview-webview en de screenshot-browser mogen nooit naar het internet wijzen. */
export function validatePreviewUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("previewUrl is geen geldige URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("previewUrl moet met http:// of https:// beginnen.");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) {
    throw new Error("previewUrl mag alleen naar localhost, 127.0.0.1 of [::1] wijzen.");
  }
  return u.toString();
}

export function parseConfig(raw: string): StudioConfig {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("studio.json moet een JSON-object zijn.");
  const d = data as Record<string, unknown>;
  const out: StudioConfig = {};
  for (const k of COMMAND_KEYS) {
    const v = d[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v.trim() || v.length > 1000 || /[\0\r\n]/.test(v)) {
      throw new Error(`"${k}" moet een niet-lege tekst van één regel zijn (max 1000 tekens).`);
    }
    out[k] = v.trim();
  }
  if (d.previewUrl !== undefined) {
    if (typeof d.previewUrl !== "string") throw new Error('"previewUrl" moet tekst zijn.');
    out.previewUrl = validatePreviewUrl(d.previewUrl);
  }
  if (d.timeoutSec !== undefined) {
    if (typeof d.timeoutSec !== "number" || !Number.isFinite(d.timeoutSec) || d.timeoutSec < 1 || d.timeoutSec > 3600) {
      throw new Error('"timeoutSec" moet een getal tussen 1 en 3600 zijn.');
    }
    out.timeoutSec = Math.floor(d.timeoutSec);
  }
  return out;
}

export async function loadConfig(projectDir: string): Promise<LoadedConfig> {
  let file: string;
  try {
    file = await resolveInside(projectDir, CONFIG_FILE);
    if ((await stat(file)).size > MAX_BYTES) return { exists: true, config: null, hash: null, error: "studio.json is te groot." };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, config: null, hash: null };
    return { exists: false, config: null, hash: null, error: (e as Error).message };
  }
  const raw = await readFile(file);
  const hash = createHash("sha256").update(raw).digest("hex");
  try {
    return { exists: true, config: parseConfig(raw.toString("utf8")), hash };
  } catch (e) {
    return { exists: true, config: null, hash, error: (e as Error).message };
  }
}

/** Maakt een voorbeeldbestand aan, maar overschrijft nooit iets. */
export async function initConfig(projectDir: string): Promise<boolean> {
  const file = await resolveInside(projectDir, CONFIG_FILE);
  try {
    await writeFile(file, JSON.stringify(STARTER_CONFIG, null, 2) + "\n", { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

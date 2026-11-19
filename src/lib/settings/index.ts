/**
 * De instellingen van Studio (voor alle projecten): één register met standaardwaarde, controle en uitleg-sleutel.
 * Opgeslagen in SQLite als `ui:<sleutel>`. Een ongeldige of ontbrekende waarde geeft altijd de standaardwaarde en blokkeert nooit.
 * Het versienummer (`settings_version`) maakt veilige migraties mogelijk als er later iets verandert.
 */
export const SETTINGS_VERSION = 1;

export type SettingKey = "communication_mode" | "permission_mode" | "plan_default" | "loop_threshold" | "theme" | "text_scale" | "preview_auto_switch" | "default_project_dir" | "menu_collapsed" | "update_check" | "eerste_start_klaar" | "model_beleid" | "model_eigen" | "kaart_aan";

export interface Settings {
  communication_mode: "simple" | "technical";
  permission_mode: "always" | "important" | "autonomous";
  plan_default: boolean;
  loop_threshold: number;
  theme: "system" | "light" | "dark";
  text_scale: 90 | 100 | 115 | 130;
  preview_auto_switch: boolean;
  default_project_dir: string;
  menu_collapsed: boolean;
  /** Bij het openen van Studio kijken of er een nieuwe versie is. */
  update_check: boolean;
  /** De eerste-startschermen zijn doorlopen (of overgeslagen). */
  eerste_start_klaar: boolean;
  /** Hoeveel denkkracht de AI inzet: Studio kiest zelf, of een vaste keuze. */
  model_beleid: "auto" | "zuinig" | "gebalanceerd" | "best";
  /** Voor gevorderden: een eigen modelnaam; leeg = Studio kiest. */
  model_eigen: string;
  /** De projectkaart helpt de AI sneller het goede bestand te vinden. */
  kaart_aan: boolean;
}

interface Def<K extends SettingKey> {
  /** Standaardwaarde, in de vorm waarin ze wordt opgeslagen. */
  standaard: string;
  /** Leest de opgeslagen tekst; `null` als die niet geldig is. */
  lees: (raw: string) => Settings[K] | null;
}

const oneOf =
  <T extends string>(...opties: T[]) =>
  (raw: string): T | null =>
    (opties as string[]).includes(raw) ? (raw as T) : null;

export const REGISTER: { [K in SettingKey]: Def<K> } = {
  communication_mode: { standaard: "simple", lees: oneOf("simple", "technical") },
  permission_mode: { standaard: "important", lees: oneOf("always", "important", "autonomous") },
  plan_default: { standaard: "0", lees: (r) => (r === "1" ? true : r === "0" ? false : null) },
  loop_threshold: { standaard: "3", lees: (r) => (/^\d+$/.test(r) && Number(r) >= 2 && Number(r) <= 10 ? Number(r) : null) },
  theme: { standaard: "system", lees: oneOf("system", "light", "dark") },
  text_scale: { standaard: "100", lees: (r) => ([90, 100, 115, 130] as const).find((n) => String(n) === r) ?? null },
  preview_auto_switch: { standaard: "0", lees: (r) => (r === "1" ? true : r === "0" ? false : null) },
  default_project_dir: { standaard: "", lees: (r) => (r.length <= 1000 && !r.includes("\0") ? r : null) },
  menu_collapsed: { standaard: "0", lees: (r) => (r === "1" ? true : r === "0" ? false : null) },
  update_check: { standaard: "1", lees: (r) => (r === "1" ? true : r === "0" ? false : null) },
  eerste_start_klaar: { standaard: "0", lees: (r) => (r === "1" ? true : r === "0" ? false : null) },
  model_beleid: { standaard: "auto", lees: oneOf("auto", "zuinig", "gebalanceerd", "best") },
  model_eigen: { standaard: "", lees: (r) => (r.length <= 60 && /^[A-Za-z0-9._\-[\]:]*$/.test(r) ? r : null) },
  kaart_aan: { standaard: "1", lees: (r) => (r === "1" ? true : r === "0" ? false : null) },
};

export const SETTING_KEYS = Object.keys(REGISTER) as SettingKey[];

/** Zet een waarde om naar de opgeslagen tekst. */
export const bewaar = (v: string | number | boolean): string => (typeof v === "boolean" ? (v ? "1" : "0") : String(v));

export function parseSetting<K extends SettingKey>(key: K, raw: string | null | undefined): Settings[K] {
  const def = REGISTER[key] as Def<K>;
  const ok = raw == null ? null : def.lees(raw);
  return (ok ?? def.lees(def.standaard)) as Settings[K];
}

export const defaults = (): Settings => Object.fromEntries(SETTING_KEYS.map((k) => [k, parseSetting(k, null)])) as unknown as Settings;

export interface SettingsStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  reset(key: string): Promise<void>;
}

/** Leest alle instellingen. Een storing bij één sleutel geeft voor die sleutel de standaardwaarde. */
export async function loadSettings(store: Pick<SettingsStorage, "get">): Promise<Settings> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    SETTING_KEYS.map(async (k) => {
      out[k] = parseSetting(k, await store.get(k).catch(() => null));
    }),
  );
  return out as unknown as Settings;
}

export type SettingsMigratie = (store: SettingsStorage) => Promise<void>;
/** `MIGRATIES[n]` brengt de instellingen van versie n naar n + 1. Versie 1 is de eerste: alleen ongeldige waarden opruimen. */
export const MIGRATIES: Record<number, SettingsMigratie> = {
  0: async (store) => {
    for (const k of SETTING_KEYS) {
      const raw = await store.get(k).catch(() => null);
      if (raw != null && (REGISTER[k] as Def<SettingKey>).lees(raw) === null) await store.reset(k).catch(() => undefined);
    }
  },
};

/** Brengt de opgeslagen instellingen op de huidige versie. Mislukt dit, dan blijft alles werken met de standaardwaarden. */
export async function migrateSettings(store: SettingsStorage, migraties: Record<number, SettingsMigratie> = MIGRATIES, doel = SETTINGS_VERSION): Promise<number> {
  let versie = Number(await store.get("settings_version").catch(() => null));
  if (!Number.isInteger(versie) || versie < 0) versie = 0;
  if (versie > doel) return versie; // nieuwer dan wij kennen: niets aanraken
  for (let v = versie; v < doel; v++) {
    try {
      await migraties[v]?.(store);
    } catch {
      return v;
    }
  }
  if (versie !== doel) await store.set("settings_version", String(doel)).catch(() => undefined);
  return doel;
}

import { vi } from "vitest";
import { bewaar, defaults, loadSettings, migrateSettings, parseSetting, REGISTER, SETTING_KEYS, SETTINGS_VERSION, type SettingsStorage } from "./index";

function opslag(start: Record<string, string> = {}) {
  const data = { ...start };
  const s: SettingsStorage & { data: Record<string, string> } = {
    data,
    get: vi.fn(async (k: string) => data[k] ?? null),
    set: vi.fn(async (k: string, v: string) => void (data[k] = v)),
    reset: vi.fn(async (k: string) => void delete data[k]),
  };
  return s;
}

describe("instellingen: standaarden en controle", () => {
  it("elke instelling heeft een geldige standaardwaarde", () => {
    for (const k of SETTING_KEYS) expect((REGISTER[k].lees as (r: string) => unknown)(REGISTER[k].standaard), k).not.toBeNull();
    expect(defaults()).toEqual({
      communication_mode: "simple",
      permission_mode: "important",
      plan_default: false,
      loop_threshold: 3,
      theme: "system",
      text_scale: 100,
      preview_auto_switch: false,
      default_project_dir: "",
      menu_collapsed: false,
      update_check: true,
      eerste_start_klaar: false,
      model_beleid: "auto",
      model_eigen: "",
      kaart_aan: true,
    });
  });

  it("een ontbrekende of ongeldige waarde valt terug op de standaard", () => {
    expect(parseSetting("permission_mode", null)).toBe("important");
    expect(parseSetting("permission_mode", "alles-mag")).toBe("important");
    expect(parseSetting("permission_mode", "autonomous")).toBe("autonomous");
    expect(parseSetting("loop_threshold", "1")).toBe(3);
    expect(parseSetting("loop_threshold", "11")).toBe(3);
    expect(parseSetting("loop_threshold", "abc")).toBe(3);
    expect(parseSetting("loop_threshold", "7")).toBe(7);
    expect(parseSetting("model_beleid", "onzin")).toBe("auto");
    expect(parseSetting("model_beleid", "best")).toBe("best");
    expect(parseSetting("model_eigen", "opus; rm -rf")).toBe("");
    expect(parseSetting("model_eigen", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(parseSetting("kaart_aan", "0")).toBe(false);
    expect(parseSetting("text_scale", "500")).toBe(100);
    expect(parseSetting("text_scale", "130")).toBe(130);
    expect(parseSetting("theme", "paars")).toBe("system");
    expect(parseSetting("plan_default", "ja")).toBe(false);
    expect(parseSetting("default_project_dir", "a\0b")).toBe("");
  });

  it("bewaar zet waarden om naar opgeslagen tekst", () => {
    expect([bewaar(true), bewaar(false), bewaar(115), bewaar("dark")]).toEqual(["1", "0", "115", "dark"]);
  });

  it("alles laden: kapotte waarden en storingen geven standaarden, nooit een fout", async () => {
    const s = opslag({ theme: "dark", loop_threshold: "x", text_scale: "115" });
    const l = await loadSettings(s);
    expect([l.theme, l.loop_threshold, l.text_scale]).toEqual(["dark", 3, 115]);
    const stuk = { get: vi.fn().mockRejectedValue(new Error("db weg")) };
    expect((await loadSettings(stuk)).permission_mode).toBe("important");
  });
});

describe("instellingen: migreren", () => {
  it("een nieuwe installatie krijgt het huidige versienummer en verder niets", async () => {
    const s = opslag();
    expect(await migrateSettings(s)).toBe(SETTINGS_VERSION);
    expect(s.data).toEqual({ settings_version: String(SETTINGS_VERSION) });
  });

  it("versie 0 ruimt ongeldige waarden op en laat geldige met rust", async () => {
    const s = opslag({ theme: "dark", permission_mode: "kapot", loop_threshold: "99" });
    await migrateSettings(s);
    expect(s.data).toEqual({ theme: "dark", settings_version: "1" });
  });

  it("een nieuwere versie dan we kennen wordt niet aangeraakt", async () => {
    const s = opslag({ settings_version: "9", permission_mode: "kapot" });
    expect(await migrateSettings(s)).toBe(9);
    expect(s.set).not.toHaveBeenCalled();
    expect(s.reset).not.toHaveBeenCalled();
  });

  it("migreert stap voor stap en stopt veilig als een stap mislukt", async () => {
    const volgorde: number[] = [];
    const s = opslag({ settings_version: "0" });
    const m = { 0: async () => void volgorde.push(0), 1: async () => void volgorde.push(1) };
    expect(await migrateSettings(s, m, 2)).toBe(2);
    expect(volgorde).toEqual([0, 1]);
    const s2 = opslag({ settings_version: "0" });
    const kapot = { 0: async () => void volgorde.push(5), 1: async () => Promise.reject(new Error("stuk")) };
    expect(await migrateSettings(s2, kapot, 2)).toBe(1);
    expect(s2.data.settings_version).toBe("0");
  });

  it("een storing in de opslag blokkeert niet", async () => {
    const s = { get: vi.fn().mockRejectedValue(new Error("x")), set: vi.fn().mockRejectedValue(new Error("x")), reset: vi.fn().mockRejectedValue(new Error("x")) };
    await expect(migrateSettings(s)).resolves.toBe(SETTINGS_VERSION);
  });
});

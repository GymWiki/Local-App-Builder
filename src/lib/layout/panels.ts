/** Alle panelen van de werkruimte. De volgorde van `MENU` is de volgorde in het linkermenu (zie ook `src/lib/menu`). */
export const MENU = ["start", "schermen", "uiterlijk", "bestanden", "gegevens", "onlinezetten", "appwinkel", "versies", "instellingen", "hulp"] as const;
export const GEVORDERD = ["terminal", "logs", "technischestatus", "code"] as const;
export const KERN = ["preview", "eigenschappen", "chat"] as const;

export const PANEL_IDS = [...MENU, ...GEVORDERD, ...KERN] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** Waar een paneel standaard verschijnt als je het opent. */
export type Plek = "links" | "midden" | "rechts";

export interface PanelDef {
  id: PanelId;
  plek: Plek;
  /** Kan de gebruiker dit paneel sluiten? Preview en chat niet: zonder die twee is er niets te doen. */
  sluitbaar: boolean;
  /** Blijft het paneel in het geheugen als het niet zichtbaar is (nodig voor preview, chat en terminal)? */
  behouden: boolean;
  /** Minimale grootte in pixels (CSS-px), zodat niets onbruikbaar klein wordt. */
  minBreedte: number;
  minHoogte: number;
}

const DEF = (id: PanelId, plek: Plek, extra: Partial<PanelDef> = {}): PanelDef => ({ id, plek, sluitbaar: true, behouden: false, minBreedte: 220, minHoogte: 120, ...extra });

export const PANELEN: Record<PanelId, PanelDef> = {
  start: DEF("start", "links", { minBreedte: 260 }),
  schermen: DEF("schermen", "links", { minBreedte: 260 }),
  uiterlijk: DEF("uiterlijk", "midden", { minBreedte: 280 }),
  bestanden: DEF("bestanden", "links", { minBreedte: 260 }),
  gegevens: DEF("gegevens", "midden", { minBreedte: 280 }),
  onlinezetten: DEF("onlinezetten", "midden", { minBreedte: 280 }),
  appwinkel: DEF("appwinkel", "midden", { minBreedte: 280 }),
  versies: DEF("versies", "links", { minBreedte: 260 }),
  instellingen: DEF("instellingen", "midden", { minBreedte: 280 }),
  hulp: DEF("hulp", "links", { minBreedte: 260 }),
  terminal: DEF("terminal", "midden", { behouden: true, minBreedte: 300, minHoogte: 160 }),
  logs: DEF("logs", "midden", { minBreedte: 280 }),
  technischestatus: DEF("technischestatus", "midden", { minBreedte: 280 }),
  code: DEF("code", "midden", { minBreedte: 300 }),
  preview: DEF("preview", "midden", { sluitbaar: false, behouden: true, minBreedte: 300, minHoogte: 200 }),
  eigenschappen: DEF("eigenschappen", "rechts", { minBreedte: 240, minHoogte: 110 }),
  chat: DEF("chat", "rechts", { sluitbaar: false, behouden: true, minBreedte: 300, minHoogte: 300 }),
};

export const isPanelId = (v: unknown): v is PanelId => typeof v === "string" && (PANEL_IDS as readonly string[]).includes(v);

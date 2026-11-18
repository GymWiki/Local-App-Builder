/** Alle panelen van de werkruimte. De volgorde van `SECTIES` is de volgorde van de iconenbalk. */
export const SECTIES = ["structuur", "componenten", "uiterlijk", "database", "koppelingen", "publiceren", "geschiedenis", "accounts", "instellingen"] as const;
export const KERN = ["preview", "eigenschappen", "chat"] as const;
export const EXTRA = ["geavanceerd"] as const;

export const PANEL_IDS = [...SECTIES, ...KERN, ...EXTRA] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type SectieId = (typeof SECTIES)[number];

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
  structuur: DEF("structuur", "links"),
  componenten: DEF("componenten", "links"),
  uiterlijk: DEF("uiterlijk", "midden", { minBreedte: 280 }),
  database: DEF("database", "links"),
  koppelingen: DEF("koppelingen", "links"),
  publiceren: DEF("publiceren", "midden", { minBreedte: 280 }),
  geschiedenis: DEF("geschiedenis", "links"),
  accounts: DEF("accounts", "midden", { minBreedte: 280 }),
  instellingen: DEF("instellingen", "midden", { minBreedte: 280 }),
  geavanceerd: DEF("geavanceerd", "midden", { behouden: true, minBreedte: 300, minHoogte: 160 }),
  preview: DEF("preview", "midden", { sluitbaar: false, behouden: true, minBreedte: 300, minHoogte: 200 }),
  eigenschappen: DEF("eigenschappen", "rechts", { minBreedte: 240, minHoogte: 110 }),
  chat: DEF("chat", "rechts", { sluitbaar: false, behouden: true, minBreedte: 300, minHoogte: 300 }),
};

export const isPanelId = (v: unknown): v is PanelId => typeof v === "string" && (PANEL_IDS as readonly string[]).includes(v);

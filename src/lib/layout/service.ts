import type { IJsonModel, IJsonRowNode, IJsonTabNode, IJsonTabSetNode } from "flexlayout-react";
import { defaultLayout, tab } from "./defaults";
import { isPanelId, PANELEN, type PanelId } from "./panels";

/** Versienummer van het opslagformaat. Verhoog het bij elke wijziging in de structuur en voeg een migratie toe. */
export const LAYOUT_VERSION = 2;

export type Migratie = (json: unknown) => unknown;
/** Versie 1 → 2: het nieuwe menu. Oude panelen krijgen hun nieuwe naam; wat niet meer bestaat verdwijnt. */
const HERNOEM_V1: Record<string, string | null> = {
  structuur: "schermen",
  componenten: null,
  koppelingen: null,
  database: "gegevens",
  publiceren: "onlinezetten",
  geschiedenis: "versies",
  accounts: "instellingen",
  geavanceerd: "terminal",
};

function hernoemKnoop(n: unknown, gezien: Set<string>): unknown | null {
  if (typeof n !== "object" || n === null || Array.isArray(n)) return n;
  const o = n as Record<string, unknown>;
  if (o.type === "tab") {
    const c = typeof o.component === "string" ? o.component : "";
    const nieuw = c in HERNOEM_V1 ? HERNOEM_V1[c] : c;
    if (!nieuw || gezien.has(nieuw)) return null;
    gezien.add(nieuw);
    return { ...o, component: nieuw, id: nieuw };
  }
  if (Array.isArray(o.children)) {
    const kinderen = o.children.map((k) => hernoemKnoop(k, gezien)).filter((k) => k !== null);
    // Een lege groep of rij (behalve de bovenste) verdwijnt.
    if (kinderen.length === 0 && o.id !== "root") return null;
    return { ...o, children: kinderen, ...(typeof o.selected === "number" ? { selected: 0 } : {}) };
  }
  return n;
}

export const MIGRATIES: Record<number, Migratie> = {
  1: (json) => {
    if (typeof json !== "object" || json === null) return json;
    const j = json as Record<string, unknown>;
    // Zwevende vensters van versie 1 laten we vallen: ze bevatten alleen oude panelen, die ook al zijn verhuisd.
    return { ...j, layout: hernoemKnoop(j.layout, new Set<string>()), subLayouts: undefined };
  },
};

const MAX_KNOPEN = 60;
const MAX_DIEPTE = 8;
const MAX_FLOATS = 6;

/** Zet een opgeslagen indeling van een oudere versie stap voor stap om. `null` als dat niet kan (te nieuw, stap ontbreekt of fout). */
export function migreer(json: unknown, van: number, naar = LAYOUT_VERSION, migraties: Record<number, Migratie> = MIGRATIES): unknown | null {
  if (!Number.isInteger(van) || van < 0 || van > naar) return null;
  let cur = json;
  for (let v = van; v < naar; v++) {
    const stap = migraties[v];
    if (!stap) return null;
    try {
      cur = stap(cur);
    } catch {
      return null;
    }
  }
  return cur;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const goedGetal = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0);

interface Telling {
  knopen: number;
  tabs: Set<PanelId>;
}

function controleerTab(n: unknown, t: Telling): IJsonTabNode | null {
  if (!isObj(n) || n.type !== "tab" || !isPanelId(n.component)) return null;
  if (t.tabs.has(n.component)) return null; // elk paneel hoogstens één keer
  t.tabs.add(n.component);
  return tab(n.component); // altijd de vaste definitie: een met de hand aangepaste tab kan niets kapotmaken
}

function controleerRij(n: unknown, t: Telling, diepte: number, isRoot = false): IJsonRowNode | null {
  if (!isObj(n) || n.type !== "row" || !Array.isArray(n.children) || diepte > MAX_DIEPTE || ++t.knopen > MAX_KNOPEN) return null;
  if (!goedGetal(n.weight)) return null;
  const kinderen: (IJsonRowNode | IJsonTabSetNode)[] = [];
  for (const k of n.children) {
    const c = isObj(k) && k.type === "row" ? controleerRij(k, t, diepte + 1) : controleerTabset(k, t);
    if (!c) return null;
    kinderen.push(c);
  }
  if (kinderen.length === 0 && !isRoot) return null;
  return { ...(n as IJsonRowNode), children: kinderen };
}

function controleerTabset(n: unknown, t: Telling): IJsonTabSetNode | null {
  if (!isObj(n) || n.type !== "tabset" || !Array.isArray(n.children) || ++t.knopen > MAX_KNOPEN) return null;
  if (!goedGetal(n.weight) || !goedGetal(n.width) || !goedGetal(n.height)) return null;
  const tabs: IJsonTabNode[] = [];
  for (const k of n.children) {
    const c = controleerTab(k, t);
    if (!c) return null;
    tabs.push(c);
  }
  const sel = typeof n.selected === "number" && n.selected >= 0 && n.selected < tabs.length ? n.selected : 0;
  const min = tabs.length ? Math.max(...tabs.map((x) => PANELEN[x.component as PanelId].minBreedte)) : undefined;
  return { ...(n as IJsonTabSetNode), children: tabs, selected: tabs.length ? sel : undefined, minWidth: min };
}

/**
 * Controleert een indeling streng en geeft een schone kopie terug, of `null` bij twijfel.
 * Eisen: bekende panelen, elk hoogstens één keer, preview en chat aanwezig, een beperkt aantal knopen, geldige getallen.
 */
export function valideer(json: unknown): IJsonModel | null {
  if (!isObj(json)) return null;
  const t: Telling = { knopen: 0, tabs: new Set() };
  const layout = controleerRij(json.layout, t, 0, true);
  if (!layout) return null;
  const out: IJsonModel = { global: isObj(json.global) ? (json.global as IJsonModel["global"]) : defaultLayout().global, borders: [], layout };
  if (json.subLayouts !== undefined) {
    if (!isObj(json.subLayouts) || Object.keys(json.subLayouts).length > MAX_FLOATS) return null;
    const subs: NonNullable<IJsonModel["subLayouts"]> = {};
    for (const [k, v] of Object.entries(json.subLayouts)) {
      if (!isObj(v)) return null;
      const rij = controleerRij(v.layout, t, 1, true);
      if (!rij) return null;
      const r = isObj(v.rect) ? v.rect : null;
      if (r && !(["x", "y", "width", "height"] as const).every((s) => typeof r[s] === "number" && Number.isFinite(r[s]))) return null;
      subs[k] = { ...(v as object), layout: rij } as NonNullable<IJsonModel["subLayouts"]>[string];
    }
    out.subLayouts = subs;
  }
  if (!t.tabs.has("preview") || !t.tabs.has("chat")) return null;
  return out;
}

export interface Opgeslagen {
  versie: number;
  json: string;
}

export const serialiseer = (json: IJsonModel): Opgeslagen => ({ versie: LAYOUT_VERSION, json: JSON.stringify(json) });

export type Bron = "opgeslagen" | "gemigreerd" | "standaard" | "hersteld";
export interface Geladen {
  json: IJsonModel;
  bron: Bron;
}

/** Leest een opgeslagen indeling: geldig → gebruiken, oud → migreren, kapot of te nieuw → de standaardindeling. Gooit nooit een fout. */
export function lees(stored: Opgeslagen | null, migraties: Record<number, Migratie> = MIGRATIES): Geladen {
  if (!stored) return { json: defaultLayout(), bron: "standaard" };
  let ruw: unknown;
  try {
    ruw = JSON.parse(stored.json);
  } catch {
    return { json: defaultLayout(), bron: "hersteld" };
  }
  const gemigreerd = stored.versie !== LAYOUT_VERSION;
  const huidig = gemigreerd ? migreer(ruw, stored.versie, LAYOUT_VERSION, migraties) : ruw;
  const ok = huidig == null ? null : valideer(huidig);
  if (!ok) return { json: defaultLayout(), bron: "hersteld" };
  return { json: ok, bron: gemigreerd ? "gemigreerd" : "opgeslagen" };
}

/**
 * De indeling voor een heel smal venster: alles in twee groepen met tabbladen (preview met de onderdelen; chat met eigenschappen).
 * Dit is alleen een weergave; de opgeslagen indeling van de gebruiker verandert er niet door.
 */
export function compacteIndeling(json: IJsonModel): IJsonModel {
  const alle: PanelId[] = [];
  const loop = (n: IJsonRowNode | IJsonTabSetNode) => {
    if (n.type === "tabset") for (const c of (n.children ?? []) as IJsonTabNode[]) if (isPanelId(c.component)) alle.push(c.component);
    if (n.type === "row") for (const c of n.children ?? []) loop(c as IJsonRowNode | IJsonTabSetNode);
  };
  loop(json.layout);
  for (const s of Object.values(json.subLayouts ?? {})) loop(s.layout);
  const voorChat: PanelId[] = ["chat", "eigenschappen"];
  const links = ["preview" as PanelId, ...alle.filter((p) => p !== "preview" && !voorChat.includes(p))];
  const rechts = voorChat.filter((p) => alle.includes(p));
  const mk = (id: string, panelen: PanelId[], weight: number): IJsonTabSetNode => ({
    type: "tabset",
    id,
    weight,
    enableMaximize: true,
    minWidth: 240,
    children: panelen.map(tab),
  });
  return { global: json.global, borders: [], layout: { type: "row", id: "root", children: [mk("ts-midden", links, 54), mk("ts-chat", rechts, 46)] } };
}

export interface LayoutStorage {
  get(projectId: number): Promise<Opgeslagen | null>;
  set(projectId: number, versie: number, json: string): Promise<void>;
  reset(projectId: number): Promise<void>;
}

/** Beheert laden, (uitgesteld) opslaan en herstellen van de indeling per project. Los van de UI, zodat het testbaar is. */
export class LayoutService {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private wachtend = new Map<number, IJsonModel>();

  constructor(
    private storage: LayoutStorage,
    private vertraging = 400,
  ) {}

  async load(projectId: number): Promise<Geladen> {
    try {
      const g = lees(await this.storage.get(projectId));
      if (g.bron === "hersteld") await this.storage.reset(projectId).catch(() => undefined); // een kapotte regel niet blijven bewaren
      return g;
    } catch {
      return { json: defaultLayout(), bron: "hersteld" };
    }
  }

  /** Bewaart na een korte pauze, zodat slepen niet bij elke pixel naar de database schrijft. Een mislukte opslag blokkeert niets. */
  save(projectId: number, json: IJsonModel): void {
    this.wachtend.set(projectId, json);
    const oud = this.timers.get(projectId);
    if (oud) clearTimeout(oud);
    this.timers.set(
      projectId,
      setTimeout(() => void this.flushProject(projectId), this.vertraging),
    );
  }

  private async flushProject(projectId: number) {
    const t = this.timers.get(projectId);
    if (t) clearTimeout(t);
    this.timers.delete(projectId);
    const json = this.wachtend.get(projectId);
    this.wachtend.delete(projectId);
    if (!json) return;
    const o = serialiseer(json);
    try {
      await this.storage.set(projectId, o.versie, o.json);
    } catch {
      /* opslaan mag de werkruimte nooit blokkeren */
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.wachtend.keys()].map((id) => this.flushProject(id)));
  }

  async reset(projectId: number, preset?: Parameters<typeof defaultLayout>[0]): Promise<IJsonModel> {
    const t = this.timers.get(projectId);
    if (t) clearTimeout(t);
    this.timers.delete(projectId);
    this.wachtend.delete(projectId);
    await this.storage.reset(projectId).catch(() => undefined);
    return defaultLayout(preset);
  }
}

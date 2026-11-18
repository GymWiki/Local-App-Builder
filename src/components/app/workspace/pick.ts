/** Een door de gebruiker gekozen onderdeel in de preview, zoals het pickerscript het doorgeeft (zie mcp-server/src/picker-script.ts). */
export interface BreadcrumbItem {
  /** Korte naam, bijvoorbeeld "div.hero" of "h1". */
  label: string;
  selector: string;
}

export interface TokenUse {
  /** CSS-eigenschap, bijvoorbeeld "background-color". */
  prop: string;
  /** Naam van het thematoken, bijvoorbeeld "--primary". */
  token: string;
}

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  path: string;
  size: { width: number; height: number };
  styles: Record<string, string>;
  tokens: TokenUse[];
  /** Naam van het kitonderdeel (bijvoorbeeld "card" of "button"); `self` is waar als het element zelf dat onderdeel is. */
  kit: { name: string; self: boolean } | null;
  breadcrumb: BreadcrumbItem[];
  children: BreadcrumbItem[];
  childCount: number;
  hidden: boolean;
}

export interface PageInfo {
  title: string;
  path: string;
  lang: string;
  width: number;
  height: number;
  background: string;
  color: string;
  fontFamily: string;
}

/** De preview kan een besturingsknop-set beschikbaar maken voor het paneel Eigenschappen. */
export interface PreviewControl {
  startPick: () => Promise<void>;
  select: (selector: string) => void;
  clear: () => void;
  askPage: () => void;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function items(v: unknown, max: number): BreadcrumbItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, max)
    .filter(isObj)
    .map((b) => ({ label: str(b.label, 80), selector: str(b.selector, 500) }))
    .filter((b) => b.selector);
}

/** Leest een bericht van het pickerscript. Alles wordt gecontroleerd en ingekort; onbruikbare berichten geven `null`. */
export function parsePick(d: unknown): PickedElement | null {
  if (!isObj(d) || d.type !== "studio-pick" || typeof d.selector !== "string" || !d.selector) return null;
  const info = isObj(d.info) ? d.info : {};
  const styles: Record<string, string> = {};
  if (isObj(info.styles)) for (const [k, v] of Object.entries(info.styles).slice(0, 20)) styles[k.slice(0, 30)] = str(v, 200);
  const tokens = Array.isArray(info.tokens)
    ? info.tokens
        .slice(0, 30)
        .filter(isObj)
        .map((t) => ({ prop: str(t.prop, 60), token: str(t.token, 80) }))
        .filter((t) => /^--[A-Za-z0-9_-]+$/.test(t.token))
    : [];
  const size = isObj(info.size) ? { width: num(info.size.width), height: num(info.size.height) } : { width: 0, height: 0 };
  const kit = isObj(info.kit) && typeof info.kit.name === "string" ? { name: str(info.kit.name, 60), self: info.kit.self === true } : null;
  return {
    selector: d.selector.slice(0, 500),
    tag: str(d.tag, 30),
    text: str(d.text, 120),
    path: str(d.path, 500) || "/",
    size,
    styles,
    tokens,
    kit,
    breadcrumb: items(info.breadcrumb, 12),
    children: items(info.children, 12),
    childCount: num(info.childCount),
    hidden: info.hidden === true,
  };
}

export function parsePage(d: unknown): PageInfo | null {
  if (!isObj(d) || d.type !== "studio-page") return null;
  return { title: str(d.title, 120), path: str(d.path, 500) || "/", lang: str(d.lang, 20), width: num(d.width), height: num(d.height), background: str(d.background, 60), color: str(d.color, 60), fontFamily: str(d.fontFamily, 60) };
}

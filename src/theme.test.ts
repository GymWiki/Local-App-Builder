import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** oklch → lineair sRGB (Björn Ottosson), genoeg om WCAG-contrast te berekenen. */
function linear(l: number, c: number, hDeg: number): [number, number, number] {
  const a = c * Math.cos((hDeg * Math.PI) / 180);
  const b = c * Math.sin((hDeg * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(a: string, b: string, tokens: Record<string, string>): number {
  const parse = (name: string) => {
    const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(tokens[name] ?? "");
    if (!m) throw new Error(`Token ${name} is geen oklch-kleur: ${tokens[name]}`);
    return luminance(linear(+m[1], +m[2], +m[3]));
  };
  const [x, y] = [parse(a), parse(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const css = readFileSync("src/index.css", "utf8");
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"], ["card-foreground", "card"], ["popover-foreground", "popover"],
  ["primary-foreground", "primary"], ["secondary-foreground", "secondary"], ["muted-foreground", "background"],
  ["muted-foreground", "muted"], ["muted-foreground", "card"], ["accent-foreground", "accent"],
  ["destructive", "background"], ["destructive", "card"], ["destructive-foreground", "destructive"],
  ["success", "background"], ["success", "card"], ["warning", "background"], ["warning", "card"],
  ["primary", "background"], ["primary", "card"], ["sidebar-foreground", "sidebar"], ["sidebar-accent-foreground", "sidebar-accent"],
];

describe.each([[":root", "licht"], [".dark", "donker"]])("thema %s (%s)", (selector) => {
  const tokens = block(selector);
  it.each(TEXT_PAIRS)("%s op %s haalt WCAG AA (4,5:1)", (fg, bg) => {
    expect(contrast(fg, bg, tokens)).toBeGreaterThanOrEqual(4.5);
  });
  it("randen van invoervelden halen 3:1 op achtergrond en kaart", () => {
    expect(contrast("input", "background", tokens)).toBeGreaterThanOrEqual(3);
    expect(contrast("input", "card", tokens)).toBeGreaterThanOrEqual(3);
  });
  it("de focusring is goed zichtbaar (3:1)", () => {
    expect(contrast("ring", "background", tokens)).toBeGreaterThanOrEqual(3);
  });
});

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
describe.each([[":root", "licht"], [".dark", "donker"]])("terminalkleuren %s (%s)", (selector) => {
  const tokens = block(selector);
  it.each(ANSI.flatMap((n) => [[`term-${n}`], [`term-bright-${n}`]]))("%s is goed leesbaar op de achtergrond (4,5:1)", (name) => {
    expect(contrast(name, "background", tokens)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("opbouw van het thema", () => {
  it("heeft een afronding van ongeveer 0,75rem en alle kleuren staan als variabelen in dit ene bestand", () => {
    expect(block(":root").radius).toBe("0.75rem");
    for (const k of ["background", "foreground", "primary", "success", "warning", "destructive"]) {
      expect(block(":root")[k], k).toBeDefined();
      expect(block(".dark")[k], k).toBeDefined();
    }
  });
  it("bundelt de lettertypes lokaal (geen externe verzoeken)", () => {
    expect(css).toContain('@import "@fontsource-variable/atkinson-hyperlegible-next"');
    expect(css).not.toMatch(/https?:\/\//);
  });
});

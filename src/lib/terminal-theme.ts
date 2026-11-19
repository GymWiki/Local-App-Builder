import type { ITheme } from "@xterm/xterm";

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** Zet een CSS-kleur (ook oklch) om naar #rrggbb, zodat xterm hem begrijpt. Zonder canvas (bijv. in tests) blijft de tekst zoals hij is. */
export function toHex(css: string, doc: Document = document): string {
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext?.("2d", { willReadFrequently: true });
  if (!ctx) return css;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "black"; // terugvalwaarde als de kleur ongeldig is
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Het xterm-thema van het actieve Studio-thema: alle kleuren komen uit de CSS-variabelen in src/index.css. */
export function readTerminalTheme(root: HTMLElement = document.documentElement, convert: (css: string) => string = toHex): ITheme {
  const style = getComputedStyle(root);
  const v = (name: string) => convert(style.getPropertyValue(`--${name}`).trim());
  const theme: ITheme = {
    background: v("background"),
    foreground: v("foreground"),
    cursor: v("primary"),
    cursorAccent: v("background"),
    selectionBackground: v("accent"),
    selectionForeground: v("accent-foreground"),
  };
  for (const n of ANSI) {
    theme[n] = v(`term-${n}`);
    theme[`bright${n[0].toUpperCase()}${n.slice(1)}` as "brightBlack"] = v(`term-bright-${n}`);
  }
  return theme;
}

/** Het lettertype van de terminal (JetBrains Mono, lokaal gebundeld), uit de CSS-variabele --font-mono. */
export function readTerminalFont(root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, Consolas, monospace";
}

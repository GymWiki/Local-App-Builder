import { readTerminalFont, readTerminalTheme, toHex } from "./terminal-theme";

function rootWith(vars: Record<string, string>): HTMLElement {
  const el = document.createElement("div");
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(`--${k}`, v);
  document.body.appendChild(el);
  return el;
}

describe("terminalthema", () => {
  it("haalt alle kleuren uit de CSS-variabelen van het thema", () => {
    const vars: Record<string, string> = { background: "B", foreground: "F", primary: "P", accent: "A", "accent-foreground": "AF" };
    for (const n of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]) {
      vars[`term-${n}`] = `n-${n}`;
      vars[`term-bright-${n}`] = `b-${n}`;
    }
    const t = readTerminalTheme(rootWith(vars), (c) => c);
    expect(t).toMatchObject({ background: "B", foreground: "F", cursor: "P", cursorAccent: "B", selectionBackground: "A", selectionForeground: "AF" });
    expect(t.red).toBe("n-red");
    expect(t.brightBlue).toBe("b-blue");
    expect(t.brightWhite).toBe("b-white");
  });

  it("de kleuren veranderen mee als het thema (de variabelen) verandert", () => {
    const el = rootWith({ background: "licht", foreground: "x", primary: "x", accent: "x", "accent-foreground": "x" });
    expect(readTerminalTheme(el, (c) => c).background).toBe("licht");
    el.style.setProperty("--background", "donker");
    expect(readTerminalTheme(el, (c) => c).background).toBe("donker");
  });

  it("zet een CSS-kleur om naar hex via een canvas, en laat de tekst staan als er geen canvas is", () => {
    expect(toHex("oklch(0.5 0.1 200)")).toBe("oklch(0.5 0.1 200)"); // jsdom heeft geen canvas
    const fake = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {}, set fillStyle(_v: string) {}, getImageData: () => ({ data: [255, 0, 128, 255] }) }) }) } as unknown as Document;
    expect(toHex("oklch(0.5 0.1 200)", fake)).toBe("#ff0080");
  });

  it("gebruikt het lokaal gebundelde monospace-lettertype", () => {
    expect(readTerminalFont(rootWith({ "font-mono": "'JetBrains Mono Variable', monospace" }))).toContain("JetBrains Mono");
    expect(readTerminalFont(rootWith({}))).toContain("monospace");
  });
});

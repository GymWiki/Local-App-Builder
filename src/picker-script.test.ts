import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PICKER_SCRIPT } from "../mcp-server/src/picker-script";

/** Het script voert zichzelf uit in de pagina (één keer); hier draaien we het in jsdom en vangen we wat het naar Studio stuurt op. */
const sent: { type: string; [k: string]: unknown }[] = [];
let ready: unknown[] = [];

beforeAll(() => {
  if (!("CSS" in window)) (window as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
  vi.spyOn(window, "postMessage").mockImplementation(((m: { type: string }) => void sent.push(m)) as never);
  new Function(PICKER_SCRIPT)();
  ready = sent.splice(0);
});

const zet = (on: boolean, source: MessageEventSource | null = window.parent) => window.dispatchEvent(new MessageEvent("message", { data: { type: "studio-picker", on }, source }));
const klik = (el: Element) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
const pagina = (html: string) => {
  document.body.innerHTML = html;
  sent.length = 0;
};
afterEach(() => void zet(false));

describe("pickerscript (alleen in de preview)", () => {
  it("meldt zich bij Studio en doet niets zolang het niet is aangezet", () => {
    expect(ready).toEqual([{ type: "studio-picker-ready" }]);
    pagina('<button id="a">Hoi</button>');
    const e = klik(document.getElementById("a")!);
    expect(e.defaultPrevented).toBe(false);
    expect(sent).toHaveLength(0);
    expect(document.querySelector("[data-studio-picker]")).toBeNull();
  });

  it("aangezet: een klik meldt het onderdeel (selector, tekst, pagina), blokkeert de klik en zet zichzelf uit", () => {
    pagina('<main><section><button id="kop-knop" class="groot">  Afspraak   maken </button></section></main>');
    zet(true);
    const e = klik(document.getElementById("kop-knop")!);
    expect(e.defaultPrevented).toBe(true);
    expect(sent.find((m) => m.type === "studio-pick")).toMatchObject({ selector: "#kop-knop", tag: "button", text: "Afspraak maken", path: "/" });
    expect(klik(document.getElementById("kop-knop")!).defaultPrevented).toBe(false); // na een keuze staat het uit
  });

  it("maakt een eenduidige selector zonder id, ook tussen gelijke elementen", () => {
    pagina('<ul class="lijst"><li>een</li><li>twee</li><li>drie</li></ul><p class="tekst">x</p>');
    const cssPath = (window as unknown as { __studioPicker: { cssPath: (el: Element) => string } }).__studioPicker.cssPath;
    for (const el of Array.from(document.querySelectorAll("li, p"))) {
      const sel = cssPath(el);
      expect(document.querySelectorAll(sel), sel).toHaveLength(1);
      expect(document.querySelector(sel)).toBe(el);
    }
  });

  it("Escape zet de picker uit en meldt dat aan Studio; berichten van andere afzenders worden genegeerd", () => {
    pagina('<p id="p">x</p>');
    zet(true, null); // vreemde afzender
    expect(klik(document.getElementById("p")!).defaultPrevented).toBe(false);
    zet(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sent).toContainEqual({ type: "studio-pick-cancel" });
    expect(klik(document.getElementById("p")!).defaultPrevented).toBe(false);
  });

  it("laadt maar één keer", () => {
    pagina("<p>x</p>");
    new Function(PICKER_SCRIPT)();
    expect(sent.filter((m) => m.type === "studio-picker-ready")).toHaveLength(0);
  });
});

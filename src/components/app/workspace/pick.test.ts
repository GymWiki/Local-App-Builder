import { parsePage, parsePick } from "./pick";

describe("berichten van het pickerscript", () => {
  it("leest een volledig bericht", () => {
    const p = parsePick({ type: "studio-pick", selector: "#a", tag: "button", text: "Hoi", path: "/over", info: { size: { width: 10.4, height: 20 }, styles: { color: "red" }, tokens: [{ prop: "color", token: "--primary" }], kit: { name: "button", self: true }, breadcrumb: [{ label: "body", selector: "body" }], children: [], childCount: 0, hidden: false } });
    expect(p).toMatchObject({ selector: "#a", tag: "button", path: "/over", size: { width: 10, height: 20 }, kit: { name: "button", self: true } });
    expect(p!.tokens).toEqual([{ prop: "color", token: "--primary" }]);
  });

  it("weigert berichten zonder selector of van een ander type", () => {
    expect(parsePick(null)).toBeNull();
    expect(parsePick({ type: "iets-anders", selector: "a" })).toBeNull();
    expect(parsePick({ type: "studio-pick" })).toBeNull();
    expect(parsePick({ type: "studio-pick", selector: "" })).toBeNull();
  });

  it("kort alles in en laat ongeldige delen weg (preview-pagina's zijn niet te vertrouwen)", () => {
    const p = parsePick({
      type: "studio-pick",
      selector: "x".repeat(9999),
      tag: "y".repeat(500),
      text: "z".repeat(500),
      info: {
        tokens: [{ prop: "color", token: "geen-token" }, { prop: "color", token: "--ok" }, ...Array.from({ length: 100 }, () => ({ prop: "p", token: "--t" }))],
        breadcrumb: Array.from({ length: 50 }, (_, i) => ({ label: "l".repeat(500), selector: `s${i}` })),
        size: { width: "groot", height: Infinity },
        kit: { name: 5 },
        styles: "kapot",
      },
    })!;
    expect(p.selector).toHaveLength(500);
    expect(p.tag).toHaveLength(30);
    expect(p.text).toHaveLength(120);
    expect(p.tokens.length).toBeLessThanOrEqual(30);
    expect(p.tokens.every((t) => t.token.startsWith("--"))).toBe(true);
    expect(p.breadcrumb).toHaveLength(12);
    expect(p.breadcrumb[0].label).toHaveLength(80);
    expect(p.size).toEqual({ width: 0, height: 0 });
    expect(p.kit).toBeNull();
    expect(p.styles).toEqual({});
  });

  it("leest paginagegevens", () => {
    expect(parsePage({ type: "studio-page", title: "Tuin", path: "/", lang: "nl", width: 1200, height: 800, background: "a", color: "b", fontFamily: "Georgia" })).toMatchObject({ title: "Tuin", width: 1200 });
    expect(parsePage({ type: "x" })).toBeNull();
  });
});

import { vi } from "vitest";
import { Model, type IJsonModel } from "flexlayout-react";
import { compacteIndeling, defaultLayout, LAYOUT_VERSION, LayoutService, lees, migreer, PRESETS, serialiseer, valideer, type LayoutStorage, type Opgeslagen } from "./index";

const tabsIn = (json: IJsonModel): string[] => {
  const uit: string[] = [];
  const loop = (n: unknown) => {
    const o = n as { type?: string; component?: string; children?: unknown[] };
    if (o.type === "tab" && o.component) uit.push(o.component);
    o.children?.forEach(loop);
  };
  loop(json.layout);
  Object.values(json.subLayouts ?? {}).forEach((s) => loop(s.layout));
  return uit;
};

function opslag(start: Opgeslagen | null = null) {
  let cur = start;
  const s: LayoutStorage & { sets: number } = {
    sets: 0,
    get: vi.fn(async () => cur),
    set: vi.fn(async (_id, versie, json) => {
      s.sets++;
      cur = { versie, json };
    }),
    reset: vi.fn(async () => {
      cur = null;
    }),
  };
  return { s, huidig: () => cur };
}

describe("standaardindelingen", () => {
  it.each(PRESETS)("preset %s is geldig, laadt in flexlayout en heeft preview, chat en eigenschappen", (preset) => {
    const j = defaultLayout(preset);
    expect(valideer(j)).not.toBeNull();
    expect(() => Model.fromJson(j)).not.toThrow();
    expect(tabsIn(j)).toEqual(expect.arrayContaining(["preview", "chat", "eigenschappen", "structuur"]));
  });

  it("preview en chat zijn niet te sluiten; preview, chat en terminal blijven in het geheugen", () => {
    const m = Model.fromJson(defaultLayout());
    const chat = m.getNodeById("chat")!.toJson() as { enableClose: boolean; enableRenderOnDemand: boolean };
    expect(chat.enableClose).toBe(false);
    expect(chat.enableRenderOnDemand).toBe(false);
    expect((m.getNodeById("eigenschappen")!.toJson() as { enableClose: boolean }).enableClose).toBe(true);
  });
});

describe("valideren", () => {
  it("geeft een schone kopie van een geldige indeling", () => {
    const j = defaultLayout("veelChat");
    expect(tabsIn(valideer(j)!)).toEqual(tabsIn(j));
  });

  it("zet vaste eigenschappen terug, ook als iemand ze met de hand veranderde (preview mag niet sluitbaar worden)", () => {
    const j = JSON.parse(JSON.stringify(defaultLayout()));
    const preview = j.layout.children[1].children[0];
    preview.enableClose = true;
    preview.enableRenderOnDemand = true;
    const ok = valideer(j)!;
    const t = (ok.layout.children![1] as { children: { enableClose: boolean; enableRenderOnDemand: boolean }[] }).children[0];
    expect(t.enableClose).toBe(false);
    expect(t.enableRenderOnDemand).toBe(false);
  });

  it.each([
    ["geen object", "tekst"],
    ["zonder layout", { global: {} }],
    ["layout geen rij", { layout: { type: "tabset", children: [] } }],
    ["onbekend paneel", (() => { const j = JSON.parse(JSON.stringify(defaultLayout())); j.layout.children[0].children[0].component = "hacker"; return j; })()],
    ["dubbel paneel", (() => { const j = JSON.parse(JSON.stringify(defaultLayout())); j.layout.children[0].children.push(j.layout.children[1].children[0]); return j; })()],
    ["chat ontbreekt", (() => { const j = JSON.parse(JSON.stringify(defaultLayout())); j.layout.children[2].children.pop(); return j; })()],
    ["negatief gewicht", (() => { const j = JSON.parse(JSON.stringify(defaultLayout())); j.layout.children[0].weight = -5; return j; })()],
    ["gewicht NaN-achtig", (() => { const j = JSON.parse(JSON.stringify(defaultLayout())); j.layout.children[0].weight = "veel"; return j; })()],
    ["te diep", (() => { let r: Record<string, unknown> = { type: "row", children: [] }; const top = r; for (let i = 0; i < 20; i++) { const n = { type: "row", children: [] as unknown[] }; (r.children as unknown[]).push(n); r = n; } return { layout: top }; })()],
    ["te veel floats", (() => { const j = JSON.parse(JSON.stringify(defaultLayout())); j.subLayouts = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { layout: { type: "row", children: [] } }])); return j; })()],
  ])("weigert: %s", (_naam, j) => {
    expect(valideer(j)).toBeNull();
  });

  it("accepteert een zwevend paneel met een geldige plek", () => {
    const j = JSON.parse(JSON.stringify(defaultLayout()));
    j.layout.children[0].children = [];
    j.layout.children[0] = { type: "tabset", children: [{ type: "tab", component: "geavanceerd" }] };
    j.subLayouts = { f1: { type: "float", rect: { x: 10, y: 10, width: 300, height: 200 }, layout: { type: "row", children: [{ type: "tabset", children: [{ type: "tab", component: "database" }] }] } } };
    const ok = valideer(j)!;
    expect(tabsIn(ok)).toEqual(expect.arrayContaining(["geavanceerd", "database", "preview", "chat"]));
    expect(() => Model.fromJson(ok)).not.toThrow();
    j.subLayouts.f1.rect.width = Infinity;
    expect(valideer(j)).toBeNull();
  });
});

describe("lezen en migreren", () => {
  it("niets opgeslagen → standaardindeling", () => {
    expect(lees(null).bron).toBe("standaard");
  });

  it("een geldige opgeslagen indeling wordt hersteld zoals ze was", () => {
    const j = defaultLayout("veelPreview");
    const g = lees(serialiseer(j));
    expect(g.bron).toBe("opgeslagen");
    expect(tabsIn(g.json)).toEqual(tabsIn(j));
  });

  it.each([
    ["kapotte JSON", { versie: LAYOUT_VERSION, json: "{kapot" }],
    ["onzin", { versie: LAYOUT_VERSION, json: '{"layout":42}' }],
    ["versie uit de toekomst", { versie: LAYOUT_VERSION + 5, json: JSON.stringify(defaultLayout()) }],
    ["versie 0 zonder migratie", { versie: 0, json: JSON.stringify(defaultLayout()) }],
    ["negatieve versie", { versie: -1, json: JSON.stringify(defaultLayout()) }],
  ])("valt terug op de standaard bij %s", (_n, stored) => {
    const g = lees(stored);
    expect(g.bron).toBe("hersteld");
    expect(valideer(g.json)).not.toBeNull();
  });

  it("migreert een oudere versie stap voor stap", () => {
    const stappen = { 0: (j: unknown) => ({ ...(j as object), stap0: true }), 1: (j: unknown) => ({ ...(j as object), stap1: true }) };
    expect(migreer({ a: 1 }, 0, 2, stappen)).toEqual({ a: 1, stap0: true, stap1: true });
    expect(migreer({ a: 1 }, 1, 2, stappen)).toEqual({ a: 1, stap1: true });
    expect(migreer({}, 3, 2, stappen)).toBeNull();
    expect(migreer({}, 0, 2, { 0: stappen[0] })).toBeNull(); // stap ontbreekt
    expect(migreer({}, 0, 1, { 0: () => { throw new Error("stuk"); } })).toBeNull();
  });

  it("een gemigreerde indeling wordt als zodanig gemeld", () => {
    const oud = { versie: 0, json: JSON.stringify({ oud: defaultLayout() }) };
    const g = lees(oud, { 0: (j) => (j as { oud: unknown }).oud });
    expect(g.bron).toBe("gemigreerd");
    expect(tabsIn(g.json)).toContain("chat");
  });
});

describe("compacte indeling voor smalle vensters", () => {
  it("bewaart alle panelen in twee tabgroepen en is geldig", () => {
    const j = defaultLayout();
    const c = compacteIndeling(j);
    expect(tabsIn(c).sort()).toEqual(tabsIn(j).sort());
    expect(valideer(c)).not.toBeNull();
    expect(c.layout.children).toHaveLength(2);
    expect(() => Model.fromJson(c)).not.toThrow();
  });
});

describe("LayoutService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("laadt de standaard als er niets is en de opgeslagen indeling daarna", async () => {
    const { s } = opslag();
    const svc = new LayoutService(s);
    expect((await svc.load(1)).bron).toBe("standaard");
    svc.save(1, defaultLayout("veelChat"));
    await svc.flush();
    expect(tabsIn((await svc.load(1)).json)).toContain("chat");
    expect((await svc.load(1)).bron).toBe("opgeslagen");
  });

  it("bewaart pas na een korte pauze en schrijft bij snel achter elkaar wijzigen maar één keer", async () => {
    const { s } = opslag();
    const svc = new LayoutService(s, 400);
    svc.save(1, defaultLayout());
    svc.save(1, defaultLayout("veelPreview"));
    svc.save(1, defaultLayout("veelChat"));
    expect(s.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    expect(s.set).toHaveBeenCalledTimes(1);
    const bewaard = JSON.parse((s.set as unknown as { mock: { calls: [number, number, string][] } }).mock.calls[0][2]);
    expect(bewaard.layout.children[1].weight).toBe(30); // de laatste (veelChat)
  });

  it("projecten hebben elk hun eigen indeling", async () => {
    const { s } = opslag();
    const svc = new LayoutService(s, 10);
    svc.save(1, defaultLayout());
    svc.save(2, defaultLayout("veelChat"));
    await vi.advanceTimersByTimeAsync(20);
    expect(s.set).toHaveBeenCalledTimes(2);
    expect((s.set as unknown as { mock: { calls: [number][] } }).mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
  });

  it("een kapotte opgeslagen indeling blokkeert niets: standaard en de kapotte regel wordt opgeruimd", async () => {
    const { s, huidig } = opslag({ versie: LAYOUT_VERSION, json: "{kapot" });
    const g = await new LayoutService(s).load(1);
    expect(g.bron).toBe("hersteld");
    expect(valideer(g.json)).not.toBeNull();
    expect(huidig()).toBeNull();
  });

  it("een storing in de opslag geeft de standaard en geen fout; mislukt opslaan wordt genegeerd", async () => {
    const s: LayoutStorage = { get: vi.fn().mockRejectedValue(new Error("db weg")), set: vi.fn().mockRejectedValue(new Error("db weg")), reset: vi.fn().mockRejectedValue(new Error("db weg")) };
    const svc = new LayoutService(s, 10);
    expect((await svc.load(1)).bron).toBe("hersteld");
    svc.save(1, defaultLayout());
    await expect(vi.advanceTimersByTimeAsync(20)).resolves.not.toThrow();
    await expect(svc.reset(1)).resolves.toBeDefined();
  });

  it("herstel standaardindeling wist de opslag en geeft de gevraagde preset; een wachtende opslag vervalt", async () => {
    const { s, huidig } = opslag();
    const svc = new LayoutService(s, 400);
    svc.save(1, defaultLayout("veelChat"));
    const j = await svc.reset(1, "veelPreview");
    await vi.advanceTimersByTimeAsync(500);
    expect(s.set).not.toHaveBeenCalled();
    expect(huidig()).toBeNull();
    expect((j.layout.children![1] as { weight: number }).weight).toBe(64);
  });
});

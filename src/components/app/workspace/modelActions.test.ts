import { Model } from "flexlayout-react";
import { defaultLayout } from "@/lib/layout";
import {
  bestemmingenVoor,
  geefRuimteAanEigenschappen,
  verplaats,
  closePanel,
  isOpen,
  isPreviewMaximized,
  openIds,
  openPanel,
  presetModel,
  toggleMaximizePreview,
  togglePanel,
} from "./modelActions";

const nieuw = () => Model.fromJson(defaultLayout());
const tabsetVan = (m: Model, id: string) =>
  m.getNodeById(id)!.getParent()!.getId();

describe("werkruimte: panelen openen en sluiten", () => {
  it("standaard staan structuur, preview, eigenschappen en chat open", () => {
    const m = nieuw();
    expect(
      [
        ...openIds(m, [
          "start",
          "preview",
          "eigenschappen",
          "chat",
          "gegevens",
          "terminal",
        ]),
      ].sort(),
    ).toEqual(["chat", "eigenschappen", "preview", "start"]);
  });

  it("een onderdeel dat links hoort komt bij de andere linkse onderdelen", () => {
    const m = nieuw();
    openPanel(m, "bestanden");
    expect(isOpen(m, "bestanden")).toBe(true);
    expect(tabsetVan(m, "bestanden")).toBe(tabsetVan(m, "start"));
  });

  it("een breed onderdeel (terminal, publiceren) komt in het midden naast de preview", () => {
    const m = nieuw();
    openPanel(m, "terminal");
    openPanel(m, "onlinezetten");
    expect(tabsetVan(m, "terminal")).toBe(tabsetVan(m, "preview"));
    expect(tabsetVan(m, "onlinezetten")).toBe(tabsetVan(m, "preview"));
  });

  it("eigenschappen komt boven de chat als het gesloten was", () => {
    const m = nieuw();
    closePanel(m, "eigenschappen");
    expect(isOpen(m, "eigenschappen")).toBe(false);
    openPanel(m, "eigenschappen");
    expect(isOpen(m, "eigenschappen")).toBe(true);
    expect(tabsetVan(m, "eigenschappen")).not.toBe(tabsetVan(m, "chat"));
  });

  it("zonder linkse groep wordt die opnieuw links aangemaakt", () => {
    const m = nieuw();
    closePanel(m, "start");
    expect(m.getNodeById("ts-links")).toBeUndefined();
    openPanel(m, "versies");
    expect(isOpen(m, "versies")).toBe(true);
    const root = m.toJson().layout.children![0] as {
      children: { component: string }[];
    };
    expect(root.children[0].component).toBe("versies");
  });

  it("preview en chat zijn niet te sluiten", () => {
    const m = nieuw();
    closePanel(m, "preview");
    closePanel(m, "chat");
    expect(isOpen(m, "preview")).toBe(true);
    expect(isOpen(m, "chat")).toBe(true);
  });

  it("de iconenbalk schakelt: dicht → open, zichtbaar → dicht, verstopt → naar voren", () => {
    const m = nieuw();
    togglePanel(m, "onlinezetten");
    expect(isOpen(m, "onlinezetten")).toBe(true);
    // Publiceren is nu het geselecteerde tabblad; de preview zit erachter.
    togglePanel(m, "preview"); // verstopt → naar voren, niet sluiten
    expect(isOpen(m, "preview")).toBe(true);
    expect(
      (
        m.getNodeById("preview") as unknown as { isSelected(): boolean }
      ).isSelected(),
    ).toBe(true);
    togglePanel(m, "onlinezetten"); // verstopt achter de preview → naar voren
    expect(
      (
        m.getNodeById("onlinezetten") as unknown as { isSelected(): boolean }
      ).isSelected(),
    ).toBe(true);
    togglePanel(m, "onlinezetten"); // zichtbaar → sluiten
    expect(isOpen(m, "onlinezetten")).toBe(false);
  });

  it("de preview is groot te maken en weer normaal", () => {
    const m = nieuw();
    expect(isPreviewMaximized(m)).toBe(false);
    toggleMaximizePreview(m);
    expect(isPreviewMaximized(m)).toBe(true);
    toggleMaximizePreview(m);
    expect(isPreviewMaximized(m)).toBe(false);
  });

  it("de vaste indelingen geven een bruikbaar model", () => {
    for (const p of ["standaard", "veelPreview", "veelChat"] as const)
      expect(isOpen(presetModel(p), "chat")).toBe(true);
  });
});

describe("werkruimte: panelen verplaatsen met het menu", () => {
  it("naar de rand van de werkruimte (links, rechts, boven, onder)", () => {
    for (const naar of ["links", "rechts", "boven", "onder"] as const) {
      const m = nieuw();
      verplaats(m, "eigenschappen", naar);
      expect(isOpen(m, "eigenschappen")).toBe(true);
      expect(tabsetVan(m, "eigenschappen")).not.toBe(tabsetVan(m, "chat"));
    }
    const m = nieuw();
    verplaats(m, "chat", "links");
    const eerste = (m.toJson().layout.children![0] as { children: { component: string }[] }).children[0].component;
    expect(eerste).toBe("chat");
  });

  it("als tabblad naast het voorbeeld of het gesprek", () => {
    const m = nieuw();
    verplaats(m, "eigenschappen", "bijPreview");
    expect(tabsetVan(m, "eigenschappen")).toBe(tabsetVan(m, "preview"));
    verplaats(m, "start", "bijChat");
    expect(tabsetVan(m, "start")).toBe(tabsetVan(m, "chat"));
  });

  it("zwevend: het paneel blijft bestaan en staat in een los venster binnen de app", () => {
    const m = nieuw();
    verplaats(m, "eigenschappen", "zweven");
    expect(isOpen(m, "eigenschappen")).toBe(true);
    expect(Object.keys(m.toJson().subLayouts ?? {}).length).toBe(1);
  });

  it("de bestemmingen kloppen: een paneel kan niet naast zichzelf of zijn eigen groep", () => {
    const m = nieuw();
    expect(bestemmingenVoor(m, "preview")).not.toContain("bijPreview");
    expect(bestemmingenVoor(m, "chat")).not.toContain("bijChat");
    expect(bestemmingenVoor(m, "eigenschappen")).toContain("bijPreview");
    expect(bestemmingenVoor(m, "eigenschappen")).toContain("zweven");
  });

  it("onbekend of gesloten paneel doet niets", () => {
    const m = nieuw();
    const voor = JSON.stringify(m.toJson());
    verplaats(m, "gegevens", "links");
    expect(JSON.stringify(m.toJson())).toBe(voor);
  });
});

describe("werkruimte: ruimte voor Eigenschappen", () => {
  const gewichten = (m: Model) => {
    const rij = m.getNodeById("eigenschappen")!.getParent()!.getParent()!;
    return (rij.getChildren() as unknown as { getWeight(): number }[]).map((k) => k.getWeight());
  };

  it("geeft Eigenschappen meer ruimte als het klein is, en laat het verder met rust", () => {
    const m = nieuw();
    const [voor] = gewichten(m);
    expect(voor).toBeLessThan(45);
    geefRuimteAanEigenschappen(m);
    const [na, chat] = gewichten(m);
    expect(na / (na + chat)).toBeCloseTo(0.55, 1);
    geefRuimteAanEigenschappen(m); // al groot genoeg
    expect(gewichten(m)[0]).toBeCloseTo(na, 5);
  });

  it("doet niets als Eigenschappen of het gesprek elders staat", () => {
    const m = nieuw();
    verplaats(m, "eigenschappen", "bijPreview");
    const voor = JSON.stringify(m.toJson());
    geefRuimteAanEigenschappen(m);
    expect(JSON.stringify(m.toJson())).toBe(voor);
  });
});

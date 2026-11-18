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
          "structuur",
          "preview",
          "eigenschappen",
          "chat",
          "database",
          "geavanceerd",
        ]),
      ].sort(),
    ).toEqual(["chat", "eigenschappen", "preview", "structuur"]);
  });

  it("een onderdeel dat links hoort komt bij de andere linkse onderdelen", () => {
    const m = nieuw();
    openPanel(m, "database");
    expect(isOpen(m, "database")).toBe(true);
    expect(tabsetVan(m, "database")).toBe(tabsetVan(m, "structuur"));
  });

  it("een breed onderdeel (terminal, publiceren) komt in het midden naast de preview", () => {
    const m = nieuw();
    openPanel(m, "geavanceerd");
    openPanel(m, "publiceren");
    expect(tabsetVan(m, "geavanceerd")).toBe(tabsetVan(m, "preview"));
    expect(tabsetVan(m, "publiceren")).toBe(tabsetVan(m, "preview"));
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
    closePanel(m, "structuur");
    expect(m.getNodeById("ts-links")).toBeUndefined();
    openPanel(m, "geschiedenis");
    expect(isOpen(m, "geschiedenis")).toBe(true);
    const root = m.toJson().layout.children![0] as {
      children: { component: string }[];
    };
    expect(root.children[0].component).toBe("geschiedenis");
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
    togglePanel(m, "publiceren");
    expect(isOpen(m, "publiceren")).toBe(true);
    // Publiceren is nu het geselecteerde tabblad; de preview zit erachter.
    togglePanel(m, "preview"); // verstopt → naar voren, niet sluiten
    expect(isOpen(m, "preview")).toBe(true);
    expect(
      (
        m.getNodeById("preview") as unknown as { isSelected(): boolean }
      ).isSelected(),
    ).toBe(true);
    togglePanel(m, "publiceren"); // verstopt achter de preview → naar voren
    expect(
      (
        m.getNodeById("publiceren") as unknown as { isSelected(): boolean }
      ).isSelected(),
    ).toBe(true);
    togglePanel(m, "publiceren"); // zichtbaar → sluiten
    expect(isOpen(m, "publiceren")).toBe(false);
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
    verplaats(m, "structuur", "bijChat");
    expect(tabsetVan(m, "structuur")).toBe(tabsetVan(m, "chat"));
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
    verplaats(m, "database", "links");
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

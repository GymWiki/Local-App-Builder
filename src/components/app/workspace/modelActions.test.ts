import { Model } from "flexlayout-react";
import { defaultLayout } from "@/lib/layout";
import {
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

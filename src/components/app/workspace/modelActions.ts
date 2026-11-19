import {
  Actions,
  DockLocation,
  Model,
  type Node,
  type TabNode,
  type TabSetNode,
} from "flexlayout-react";
import {
  defaultLayout,
  PANELEN,
  PANEL_IDS,
  tab,
  type PanelId,
  type PresetId,
} from "@/lib/layout";

/** Is dit paneel nu ergens in de indeling (ook als tabblad achter een ander paneel)? */
export const isOpen = (model: Model, id: PanelId): boolean =>
  !!model.getNodeById(id);

export const openIds = (model: Model, ids: readonly PanelId[]): Set<PanelId> =>
  new Set(ids.filter((id) => isOpen(model, id)));

const parentTabset = (model: Model, id: string): TabSetNode | undefined => {
  const p = model.getNodeById(id)?.getParent() as Node | undefined;
  return p && p.getType() === "tabset" ? (p as TabSetNode) : undefined;
};

/** Zet een paneel op zijn standaardplek: links bij de andere onderdelen, in het midden naast de preview, of boven de chat. */
export function openPanel(model: Model, id: PanelId): void {
  if (isOpen(model, id)) {
    model.doAction(Actions.selectTab(id));
    return;
  }
  const def = PANELEN[id];
  if (def.plek === "rechts") {
    const chat = parentTabset(model, "chat");
    if (chat)
      model.doAction(
        Actions.addNode(tab(id), chat.getId(), DockLocation.TOP, -1),
      );
    return;
  }
  if (def.plek === "midden") {
    const preview = parentTabset(model, "preview");
    if (preview)
      model.doAction(
        Actions.addNode(tab(id), preview.getId(), DockLocation.CENTER, -1),
      );
    return;
  }
  const buur = PANEL_IDS.filter((s) => s !== id && PANELEN[s].plek === "links")
    .map((s) => parentTabset(model, s))
    .find(Boolean);
  if (buur) {
    model.doAction(
      Actions.addNode(tab(id), buur.getId(), DockLocation.CENTER, -1),
    );
    return;
  }
  const root = model.getRootRow();
  if (root)
    model.doAction(
      Actions.addNode(tab(id), root.getId(), DockLocation.LEFT, -1),
    );
}

export const closePanel = (model: Model, id: PanelId): void => {
  if (isOpen(model, id) && PANELEN[id].sluitbaar)
    model.doAction(Actions.deleteTab(id));
};

/** Iconenbalk: dicht → openen; open maar verstopt achter een ander tabblad → naar voren; open en zichtbaar → sluiten. */
export function togglePanel(model: Model, id: PanelId): void {
  const node = model.getNodeById(id) as TabNode | undefined;
  if (!node) return openPanel(model, id);
  if (!node.isSelected()) return void model.doAction(Actions.selectTab(id));
  closePanel(model, id);
}

export function toggleMaximizePreview(model: Model): void {
  const ts = parentTabset(model, "preview");
  if (ts) model.doAction(Actions.maximizeToggle(ts.getId()));
}

export const isPreviewMaximized = (model: Model): boolean =>
  !!model.getMaximizedTabset();

export const presetModel = (preset: PresetId): Model =>
  Model.fromJson(defaultLayout(preset));

export type Bestemming = "links" | "rechts" | "boven" | "onder" | "bijPreview" | "bijChat" | "zweven";
export const BESTEMMINGEN: Bestemming[] = ["links", "rechts", "boven", "onder", "bijPreview", "bijChat", "zweven"];

/** Welke bestemmingen kloppen voor dit paneel? (Een paneel kan niet naast zichzelf.) */
export function bestemmingenVoor(model: Model, id: PanelId): Bestemming[] {
  const eigen = parentTabset(model, id)?.getId();
  return BESTEMMINGEN.filter((b) => {
    if (b === "bijPreview") return id !== "preview" && parentTabset(model, "preview")?.getId() !== eigen;
    if (b === "bijChat") return id !== "chat" && parentTabset(model, "chat")?.getId() !== eigen;
    return true;
  });
}

/** Verplaatst een paneel met een menu in plaats van slepen (voor wie niet kan slepen): naar een rand, als tabblad naast een ander paneel, of zwevend. */
export function verplaats(model: Model, id: PanelId, naar: Bestemming): void {
  if (!isOpen(model, id)) return;
  const wortel = model.getRootRow()?.getId();
  const randen = { links: DockLocation.LEFT, rechts: DockLocation.RIGHT, boven: DockLocation.TOP, onder: DockLocation.BOTTOM } as const;
  if (naar in randen && wortel) {
    model.doAction(Actions.moveNode(id, wortel, randen[naar as keyof typeof randen], -1));
  } else if (naar === "bijPreview" || naar === "bijChat") {
    const doel = parentTabset(model, naar === "bijPreview" ? "preview" : "chat");
    if (doel) model.doAction(Actions.moveNode(id, doel.getId(), DockLocation.CENTER, -1));
  } else if (naar === "zweven") {
    model.doAction(Actions.popoutTab(id, "float"));
  }
}

/** Na het kiezen van een onderdeel heeft Eigenschappen meer ruimte nodig dan in de standaardindeling: schuif de verdeling met het gesprek op. */
export function geefRuimteAanEigenschappen(model: Model): void {
  const ts = parentTabset(model, "eigenschappen");
  const chat = parentTabset(model, "chat");
  const rij = ts?.getParent();
  if (!ts || !chat || !rij || rij !== chat.getParent() || model.getMaximizedTabset()) return;
  const kinderen = rij.getChildren() as unknown as { getWeight(): number }[];
  if (kinderen.length !== 2) return;
  const gewichten = kinderen.map((k) => k.getWeight());
  const totaal = gewichten[0] + gewichten[1];
  const i = rij.getChildren().indexOf(ts);
  if (gewichten[i] / totaal >= 0.45) return;
  const nieuw = [totaal * 0.45, totaal * 0.45];
  nieuw[i] = totaal * 0.55;
  nieuw[1 - i] = totaal - nieuw[i];
  model.doAction(Actions.adjustWeights(rij.getId(), nieuw));
}

/** Welke panelen zijn nu zichtbaar (het geselecteerde tabblad van hun groep)? */
export const zichtbaarIds = (model: Model, ids: readonly PanelId[]): Set<PanelId> =>
  new Set(ids.filter((id) => (model.getNodeById(id) as TabNode | undefined)?.isSelected()));

import type { IJsonModel, IJsonRowNode, IJsonTabNode, IJsonTabSetNode } from "flexlayout-react";
import { PANELEN, type PanelId } from "./panels";

/** Voor de tab-naam gebruiken we een sleutel; de echte (Nederlandse) tekst komt uit de i18n-structuur bij het tekenen. */
export const tabNaam = (id: PanelId) => `werkruimte.paneel.${id}`;

export function tab(id: PanelId): IJsonTabNode {
  const d = PANELEN[id];
  return {
    type: "tab",
    id,
    component: id,
    name: tabNaam(id),
    enableClose: d.sluitbaar,
    enableRenderOnDemand: !d.behouden,
    enablePopout: false,
    enableFloat: true,
  };
}

function tabset(id: string, panelen: PanelId[], weight: number, extra: Partial<IJsonTabSetNode> = {}): IJsonTabSetNode {
  const eerste = PANELEN[panelen[0]];
  return {
    type: "tabset",
    id,
    weight,
    minWidth: Math.max(...panelen.map((p) => PANELEN[p].minBreedte)),
    minHeight: eerste.minHoogte,
    enableMaximize: true,
    children: panelen.map(tab),
    ...extra,
  };
}

export type PresetId = "standaard" | "veelPreview" | "veelChat";
export const PRESETS: PresetId[] = ["standaard", "veelPreview", "veelChat"];

const GEWICHTEN: Record<PresetId, { links: number; midden: number; rechts: number; props: number; chat: number }> = {
  standaard: { links: 16, midden: 46, rechts: 38, props: 22, chat: 78 },
  veelPreview: { links: 12, midden: 64, rechts: 24, props: 25, chat: 75 },
  veelChat: { links: 14, midden: 30, rechts: 56, props: 20, chat: 80 },
};

/** [ links: onderdelen | midden: preview | rechts: eigenschappen boven, chat onder ] */
export function defaultLayout(preset: PresetId = "standaard"): IJsonModel {
  const w = GEWICHTEN[preset];
  const rechts: IJsonRowNode = {
    type: "row",
    id: "rechts",
    weight: w.rechts,
    children: [tabset("ts-eigenschappen", ["eigenschappen"], w.props), tabset("ts-chat", ["chat"], w.chat)],
  };
  return {
    global: { tabEnableClose: true, tabSetEnableMaximize: true, enableEdgeDock: true, enableRotateBorderIcons: false },
    borders: [],
    layout: {
      type: "row",
      id: "root",
      children: [tabset("ts-links", ["structuur"], w.links), tabset("ts-midden", ["preview"], w.midden), rechts],
    },
  };
}

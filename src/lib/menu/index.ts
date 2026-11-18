/**
 * De structuur van het linkermenu en de status van de onderdelen. Alle regels staan hier (en worden getest);
 * de componenten tonen alleen wat deze functies teruggeven.
 */

export type MenuId = "start" | "schermen" | "uiterlijk" | "bestanden" | "gegevens" | "onlinezetten" | "appwinkel" | "versies" | "instellingen" | "hulp";
export type GevorderdId = "terminal" | "logs" | "technischestatus" | "code";
export type GroepId = "maken" | "delen" | "beheer";

export const GROEPEN: { id: GroepId; items: MenuId[] }[] = [
  { id: "maken", items: ["start", "schermen", "uiterlijk", "bestanden", "gegevens"] },
  { id: "delen", items: ["onlinezetten", "appwinkel"] },
  { id: "beheer", items: ["versies", "instellingen"] },
];
export const GEVORDERD: GevorderdId[] = ["terminal", "logs", "technischestatus", "code"];
/** Onderdelen die pas in het menu staan als het project ze nodig heeft (of de gebruiker ze zelf toevoegt). */
export const OPTIONEEL: MenuId[] = ["gegevens"];
/** Hulp staat als knop bovenaan het menu, zodat er in de standaardstand hoogstens acht onderdelen in de lijst staan. */
export const MAX_ZICHTBAAR = 8;

export interface Signalen {
  /** De gebruiker heeft al een eerste opdracht gegeven. */
  eersteOpdracht: boolean;
  projectMdIngevuld: boolean;
  previewDraait: boolean;
  aantalVersies: number;
  online: boolean;
  kitGekozen: boolean;
  checksFalen: boolean;
  heeftDatabase: boolean;
  needsData: boolean;
  aantalFotos: number;
  aantalSchermen: number;
}

export const geenSignalen = (): Signalen => ({
  eersteOpdracht: false,
  projectMdIngevuld: false,
  previewDraait: false,
  aantalVersies: 0,
  online: false,
  kitGekozen: false,
  checksFalen: false,
  heeftDatabase: false,
  needsData: false,
  aantalFotos: 0,
  aantalSchermen: 0,
});

export type StapId = "idee" | "voorbeeld" | "aanpassen" | "online";
export const STAPPEN: StapId[] = ["idee", "voorbeeld", "aanpassen", "online"];

/** De vier stappen van de voortgang, afgeleid uit wat er in het project te zien is. */
export function stappen(s: Signalen): { id: StapId; klaar: boolean }[] {
  const idee = s.eersteOpdracht || s.projectMdIngevuld;
  // Een opgeslagen versie bewijst dat er een voorbeeld is geweest, ook als de preview nu even uit staat.
  const voorbeeld = s.previewDraait || s.aantalVersies >= 1;
  const aanpassen = s.aantalVersies >= 2;
  return [
    { id: "idee", klaar: idee },
    { id: "voorbeeld", klaar: voorbeeld },
    { id: "aanpassen", klaar: aanpassen },
    { id: "online", klaar: s.online },
  ];
}

/** De eerste stap die nog niet klaar is, of "klaar" als alles gedaan is. */
export function volgendeStap(s: Signalen): StapId | "klaar" {
  return stappen(s).find((x) => !x.klaar)?.id ?? "klaar";
}

export type Punt = "klaar" | "actie" | "leeg";
export interface ItemStatus {
  punt: Punt;
  /** Een aantal dat naast het onderdeel getoond wordt (bijvoorbeeld het aantal versies). */
  telling?: number;
}

/** Het statusbolletje en de telling per menu-onderdeel. Onderdelen zonder status ontbreken. */
export function menuStatus(s: Signalen): Partial<Record<MenuId, ItemStatus>> {
  const alleStappen = stappen(s).every((x) => x.klaar);
  return {
    start: { punt: alleStappen ? "klaar" : "leeg" },
    schermen: { punt: s.aantalSchermen > 0 ? "klaar" : "leeg", telling: s.aantalSchermen },
    uiterlijk: { punt: s.kitGekozen ? "klaar" : "leeg" },
    bestanden: { punt: s.aantalFotos > 0 ? "klaar" : "leeg", telling: s.aantalFotos },
    gegevens: { punt: s.needsData && !s.heeftDatabase ? "actie" : s.heeftDatabase ? "klaar" : "leeg" },
    onlinezetten: { punt: s.checksFalen ? "actie" : s.online ? "klaar" : "leeg" },
    versies: { punt: s.aantalVersies > 0 ? "klaar" : "leeg", telling: s.aantalVersies },
  };
}

/** Moet "Gegevens" in het menu staan? Als er een database is, de AI opslag nodig vindt, of de gebruiker het zelf heeft toegevoegd. */
export function gegevensZichtbaar(s: Pick<Signalen, "heeftDatabase" | "needsData">, vlaggen: Record<string, string>): boolean {
  return vlaggen.gegevens_aan === "1" || s.heeftDatabase || s.needsData;
}

/** De onderdelen in het menu, per groep, in de standaardstand (zonder Hulp en zonder "Voor gevorderden"). */
export function zichtbareItems(s: Pick<Signalen, "heeftDatabase" | "needsData">, vlaggen: Record<string, string>): { id: GroepId; items: MenuId[] }[] {
  const toon = gegevensZichtbaar(s, vlaggen);
  return GROEPEN.map((g) => ({ id: g.id, items: g.items.filter((i) => i !== "hulp" && (!OPTIONEEL.includes(i) || (i === "gegevens" && toon))) }));
}

/** Verborgen onderdelen die de gebruiker zelf kan toevoegen ("Meer onderdelen"). */
export function verborgenItems(s: Pick<Signalen, "heeftDatabase" | "needsData">, vlaggen: Record<string, string>): MenuId[] {
  return OPTIONEEL.filter((i) => i === "gegevens" && !gegevensZichtbaar(s, vlaggen));
}

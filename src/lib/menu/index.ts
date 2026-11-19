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

/** Status van een koppeling met een dienst (zie Rust: connect::store::Status). */
export type KoppelStatus = "niet_gekoppeld" | "bezig" | "werkt" | "verlopen" | "fout";
export type Koppelingen = Partial<Record<"github" | "vercel" | "supabase", KoppelStatus>>;

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
  /** Status van de gekoppelde diensten; ontbrekend = nog niet bekend of niet gekoppeld. */
  koppelingen: Koppelingen;
  /** Het gekoppelde Supabase-project is gepauzeerd of heeft beveiligingsproblemen (tabellen zonder RLS enzovoort). */
  databaseProbleem: boolean;
  /** De GitHub-back-up: nog niet ingesteld, recent bijgewerkt, achterstand of een probleem. */
  backup: BackupStatus;
}

export type BackupStatus = "geen" | "recent" | "achter" | "probleem";

/** Hoe oud de laatste back-up mag zijn (met nieuwe versies erna) voordat het een achterstand heet: één dag. */
export const BACKUP_ACHTERSTAND_SECS = 86_400;

/** De status van de back-up uit de gegevens van Rust. Zonder koppeling: "geen" (leeg bolletje). */
export function backupStatus(g: { link: { probleem: string | null; uiteengelopen: string | null; laatste: number | null } | null; nieuw: number }, nu: number): BackupStatus {
  if (!g.link) return "geen";
  if (g.link.probleem || g.link.uiteengelopen) return "probleem";
  if (g.nieuw === 0) return "recent";
  return g.link.laatste === null || nu - g.link.laatste > BACKUP_ACHTERSTAND_SECS ? "achter" : "recent";
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
  koppelingen: {},
  databaseProbleem: false,
  backup: "geen",
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

const kapot = (s: Signalen, dienst: keyof Koppelingen) => s.koppelingen[dienst] === "verlopen" || s.koppelingen[dienst] === "fout";

/** Het statusbolletje en de telling per menu-onderdeel. Onderdelen zonder status ontbreken. */
export function menuStatus(s: Signalen): Partial<Record<MenuId, ItemStatus>> {
  const alleStappen = stappen(s).every((x) => x.klaar);
  return {
    start: { punt: alleStappen ? "klaar" : "leeg" },
    schermen: { punt: s.aantalSchermen > 0 ? "klaar" : "leeg", telling: s.aantalSchermen },
    uiterlijk: { punt: s.kitGekozen ? "klaar" : "leeg" },
    bestanden: { punt: s.aantalFotos > 0 ? "klaar" : "leeg", telling: s.aantalFotos },
    // Een koppeling die niet meer werkt vraagt actie ("!"); een werkende koppeling telt als gezond.
    gegevens: { punt: kapot(s, "supabase") || s.databaseProbleem || (s.needsData && !s.heeftDatabase) ? "actie" : s.heeftDatabase || s.koppelingen.supabase === "werkt" ? "klaar" : "leeg" },
    onlinezetten: { punt: s.checksFalen || kapot(s, "vercel") ? "actie" : s.online ? "klaar" : "leeg" },
    // Is de back-up ingesteld, dan bepaalt die het bolletje: ✓ recent, ! achterstand of probleem.
    versies: { punt: kapot(s, "github") || s.backup === "probleem" || s.backup === "achter" ? "actie" : s.aantalVersies > 0 || s.backup === "recent" ? "klaar" : "leeg", telling: s.aantalVersies },
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

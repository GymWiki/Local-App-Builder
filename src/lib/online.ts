/**
 * De vijf stappen naar online, in volgorde. Alleen deze functie bepaalt wat klaar is en wat de volgende stap is
 * (net als de Status-service voor het menu); de schermen tonen alleen wat hier uitkomt.
 */
export type OnlineStapId = "controles" | "gekoppeld" | "variabelen" | "voorbeeld" | "live";
export const ONLINE_STAPPEN: OnlineStapId[] = ["controles", "gekoppeld", "variabelen", "voorbeeld", "live"];

export interface OnlineSignalen {
  /** Er is een opgeslagen versie en de laatste controle faalde niet. */
  controlesGroen: boolean;
  vercelGekoppeld: boolean;
  ontbrekendeVariabelen: number;
  voorbeeldOnline: boolean;
  liveOnline: boolean;
}

export function onlineStappen(s: OnlineSignalen): { id: OnlineStapId; klaar: boolean }[] {
  return [
    { id: "controles", klaar: s.controlesGroen },
    { id: "gekoppeld", klaar: s.vercelGekoppeld },
    { id: "variabelen", klaar: s.vercelGekoppeld && s.ontbrekendeVariabelen === 0 },
    { id: "voorbeeld", klaar: s.voorbeeldOnline },
    { id: "live", klaar: s.liveOnline },
  ];
}

/** De eerste stap die nog niet klaar is, of "klaar". */
export function volgendeOnlineStap(s: OnlineSignalen): OnlineStapId | "klaar" {
  return onlineStappen(s).find((x) => !x.klaar)?.id ?? "klaar";
}

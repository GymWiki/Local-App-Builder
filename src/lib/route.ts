/**
 * De route "van idee tot app": acht stappen, bepaald uit feiten over het project (Rust: `route_feiten`). Eén plek voor de balk
 * bovenin het project en de projectkaart op het homescherm, zodat ze nooit iets anders zeggen. De route is een hulpmiddel:
 * stappen zijn over te slaan en je kunt altijd vrij rondklikken.
 */
export type RouteStapId = "idee" | "plan" | "uiterlijk" | "bouwen" | "aanpassen" | "gegevens" | "testen" | "delen";
export const ROUTE_STAPPEN: RouteStapId[] = ["idee", "plan", "uiterlijk", "bouwen", "aanpassen", "gegevens", "testen", "delen"];

export interface RouteFeiten {
  heeft_idee: boolean;
  plan_klaar: boolean;
  kit_gekozen: boolean;
  versies: number;
  gegevens_nodig: boolean;
  gegevens_klaar: boolean;
  tests_ok: boolean | null;
  back_up: boolean;
  online: boolean;
  winkel: boolean;
  overgeslagen: string[];
}

export const geenFeiten = (): RouteFeiten => ({ heeft_idee: false, plan_klaar: false, kit_gekozen: false, versies: 0, gegevens_nodig: false, gegevens_klaar: false, tests_ok: null, back_up: false, online: false, winkel: false, overgeslagen: [] });

export interface RouteStap {
  id: RouteStapId;
  klaar: boolean;
  overgeslagen: boolean;
  /** Niet nodig voor dit project (bijvoorbeeld Gegevens als de app niets hoeft te onthouden). */
  nvt: boolean;
  huidig: boolean;
}

export interface Route {
  stappen: RouteStap[];
  /** De eerste stap die nog openstaat, of "klaar". */
  huidig: RouteStapId | "klaar";
  /** 1-gebaseerd nummer van de huidige stap (8 als alles klaar is). */
  nummer: number;
  totaal: number;
}

function klaar(id: RouteStapId, f: RouteFeiten): boolean {
  switch (id) {
    case "idee":
      return f.heeft_idee;
    case "plan":
      return f.plan_klaar;
    case "uiterlijk":
      return f.kit_gekozen;
    case "bouwen":
      return f.versies >= 1;
    case "aanpassen":
      return f.versies >= 2;
    case "gegevens":
      return !f.gegevens_nodig || f.gegevens_klaar;
    case "testen":
      return f.tests_ok === true;
    case "delen":
      return f.back_up || f.online || f.winkel;
  }
}

export function bepaalRoute(f: RouteFeiten): Route {
  const stappen: RouteStap[] = ROUTE_STAPPEN.map((id) => ({ id, klaar: klaar(id, f), overgeslagen: f.overgeslagen.includes(id), nvt: id === "gegevens" && !f.gegevens_nodig, huidig: false }));
  const eerste = stappen.find((s) => !s.klaar && !s.overgeslagen);
  if (eerste) eerste.huidig = true;
  const huidig = eerste?.id ?? "klaar";
  return { stappen, huidig, nummer: eerste ? stappen.indexOf(eerste) + 1 : stappen.length, totaal: stappen.length };
}

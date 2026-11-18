/**
 * Vertaalt een ruwe foutmelding (van het besturingssysteem, een programma of een dienst) naar gewone taal met een oorzaak en een oplossing.
 * De ruwe tekst blijft beschikbaar als "details". De teksten staan in nl.json (`fouten.<code>.*`).
 */
export type FoutCode = "schijf_vol" | "niet_gevonden" | "geen_toestemming" | "in_gebruik" | "time_out" | "geen_internet" | "inloggen" | "database_bezig" | "bestaat_al" | "geen_programma" | "onbekend";

const REGELS: [FoutCode, RegExp][] = [
  ["schijf_vol", /no space left|os error 28|enospc|disk full|not enough space|onvoldoende ruimte/i],
  ["geen_toestemming", /permission denied|access is denied|os error 13|os error 5\b|eacces|eperm|operation not permitted/i],
  ["in_gebruik", /os error 32|ebusy|being used by another process|text file busy|resource busy/i],
  ["database_bezig", /database is locked|database table is locked|sqlite_busy/i],
  ["time_out", /timed out|time-out|timeout|etimedout|deadline/i],
  ["geen_internet", /network|enotfound|econnrefused|econnreset|dns|offline|geen_internet|no route to host|failed to lookup|unreachable/i],
  ["inloggen", /401|unauthori[sz]ed|not logged in|ongeldig_token|invalid token|token expired|verlopen/i],
  ["bestaat_al", /already exists|os error 17|eexist|bestaat al/i],
  ["geen_programma", /program not found|command not found|not recognized as an internal|enoent.*spawn|spawn .* enoent|is not recognized/i],
  ["niet_gevonden", /no such file|os error 2\b|enoent|not found|cannot find the (file|path)|os error 3\b/i],
];

export interface VertaaldeFout {
  code: FoutCode;
  /** De ruwe tekst, voor "Toon details". */
  details: string;
}

export function vertaalFout(raw: unknown): VertaaldeFout {
  const details = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : JSON.stringify(raw) ?? String(raw);
  const code = REGELS.find(([, re]) => re.test(details))?.[0] ?? "onbekend";
  return { code, details };
}

/** Haalt paden met een gebruikersnaam weg uit tekst die iemand gaat delen (rapport, plakken in een bericht). */
export function anonimiseer(tekst: string): string {
  return tekst.replace(/[A-Za-z]:\\Users\\[^\\"']+|(?:\/Users\/|\/home\/)[^/\s"']+/g, "~");
}

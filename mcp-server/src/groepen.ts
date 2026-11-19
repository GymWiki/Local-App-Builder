// Welke groepen diensttools (Supabase, GitHub, Vercel) zichtbaar zijn. Tools van een niet-gekoppelde dienst zijn voor de AI alleen ruis
// en kosten tokens. Studio stuurt de stand naar de runtime (`tools.set`); zonder bericht tonen we alles.
export interface Groepen {
  db: boolean;
  github: boolean;
  vercel: boolean;
}
export const ALLE_GROEPEN: Groepen = { db: true, github: true, vercel: true };

export function groepenUitArgs(args: unknown): Groepen {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const b = (k: string) => (typeof a[k] === "boolean" ? (a[k] as boolean) : true);
  return { db: b("db"), github: b("github"), vercel: b("vercel") };
}

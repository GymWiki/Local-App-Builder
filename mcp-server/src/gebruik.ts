// Haalt het AI-gebruik uit de stream-json-uitvoer van een CLI (alleen lezen, geen netwerk, geen geheimen).
// Claude Code: velden uit echte opnames (src-tauri/tests/fixtures/claude/real_*.jsonl): `usage` en `total_cost_usd` in het resultaat,
// `tool_use`-blokken in `assistant`-berichten. Gemini CLI: de docs noemen een `result`-gebeurtenis met `stats`, maar de exacte
// veldnamen zijn niet uit een echte opname bekend; daarom leest `parseGeminiStream` voorzichtig en meldt `bron: "schatting"`.

export interface Gebruik {
  cli: "claude" | "gemini";
  /** "cli" = cijfers rechtstreeks van de CLI; "gedeeltelijk" = sommige velden ontbreken; "geen" = geen cijfers gevonden. */
  bron: "cli" | "gedeeltelijk" | "geen";
  invoer: number;
  uitvoer: number;
  cacheGelezen: number;
  cacheGeschreven: number;
  toolAanroepen: number;
  /** Aantal verschillende bestanden die zijn gelezen (Read-aanroepen). */
  bestandenGelezen: number;
  beurten: number | null;
  duurMs: number | null;
  kostenUsd: number | null;
  geslaagd: boolean | null;
}

const leeg = (cli: Gebruik["cli"]): Gebruik => ({ cli, bron: "geen", invoer: 0, uitvoer: 0, cacheGelezen: 0, cacheGeschreven: 0, toolAanroepen: 0, bestandenGelezen: 0, beurten: null, duurMs: null, kostenUsd: null, geslaagd: null });
const getal = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function regels(tekst: string): Record<string, unknown>[] {
  const uit: Record<string, unknown>[] = [];
  for (const r of tekst.split(/\r?\n/)) {
    const t = r.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === "object") uit.push(o as Record<string, unknown>);
    } catch {
      /* een kapotte regel slaan we over */
    }
  }
  return uit;
}

export function parseClaudeStream(tekst: string): Gebruik {
  const g = leeg("claude");
  const gelezen = new Set<string>();
  const gezien = new Set<string>();
  let resultaat: Record<string, unknown> | null = null;
  for (const o of regels(tekst)) {
    if (o.type === "assistant") {
      const m = o.message as { id?: string; content?: unknown } | undefined;
      for (const blok of Array.isArray(m?.content) ? (m!.content as Record<string, unknown>[]) : []) {
        if (blok.type !== "tool_use") continue;
        const id = typeof blok.id === "string" ? blok.id : `${g.toolAanroepen}`;
        if (gezien.has(id)) continue; // dezelfde aanroep kan in meerdere gebeurtenissen voorkomen
        gezien.add(id);
        g.toolAanroepen++;
        const inv = (blok.input ?? {}) as Record<string, unknown>;
        if (blok.name === "Read" && typeof inv.file_path === "string") gelezen.add(inv.file_path);
      }
    } else if (o.type === "result") resultaat = o;
  }
  g.bestandenGelezen = gelezen.size;
  if (resultaat) {
    const u = (resultaat.usage ?? {}) as Record<string, unknown>;
    g.invoer = getal(u.input_tokens);
    g.uitvoer = getal(u.output_tokens);
    g.cacheGelezen = getal(u.cache_read_input_tokens);
    g.cacheGeschreven = getal(u.cache_creation_input_tokens);
    g.beurten = typeof resultaat.num_turns === "number" ? resultaat.num_turns : null;
    g.duurMs = typeof resultaat.duration_ms === "number" ? resultaat.duration_ms : null;
    g.kostenUsd = typeof resultaat.total_cost_usd === "number" ? resultaat.total_cost_usd : null;
    g.geslaagd = resultaat.is_error === false;
    // Oudere opnames hebben geen `usage`: dan zijn alleen duur en kosten bekend.
    g.bron = resultaat.usage ? "cli" : "gedeeltelijk";
  }
  return g;
}

/** Gemini: `result`-gebeurtenis met `stats`. Veldnamen zijn niet geverifieerd; we zoeken voorzichtig en melden dat het gedeeltelijk is. */
export function parseGeminiStream(tekst: string): Gebruik {
  const g = leeg("gemini");
  for (const o of regels(tekst)) {
    if (o.type === "tool_use") g.toolAanroepen++;
    if (o.type !== "result") continue;
    const s = (o.stats ?? {}) as Record<string, unknown>;
    g.invoer = getal(s.input_tokens ?? s.input ?? s.prompt_tokens);
    g.uitvoer = getal(s.output_tokens ?? s.candidates_tokens ?? s.output);
    g.cacheGelezen = getal(s.cached ?? s.cached_tokens);
    g.duurMs = typeof s.duration_ms === "number" ? s.duration_ms : null;
    g.bron = g.invoer || g.uitvoer ? "gedeeltelijk" : "geen";
    g.geslaagd = o.status ? o.status === "success" : null;
  }
  return g;
}

/** Vriendelijke samenvatting in één getal: alles wat de AI "las" (invoer + cache) en schreef. */
export function totaalVerwerkt(g: Gebruik): number {
  return g.invoer + g.cacheGelezen + g.cacheGeschreven + g.uitvoer;
}

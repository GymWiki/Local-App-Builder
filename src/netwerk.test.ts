import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Deel 10 (netwerk en privacy): de frontend praat nooit zelf met de diensten. Alle verbindingen met GitHub, Vercel en Supabase lopen via
// Rust, met een vaste lijst toegestane hosts. Deze test bewaakt dat er in de frontend-code geen directe verbindingen bijkomen.
function bestanden(dir: string, uit: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) bestanden(p, uit);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) uit.push(p);
  }
  return uit;
}

describe("netwerk en privacy", () => {
  const src = bestanden(path.resolve(__dirname));

  it("de frontend doet geen eigen netwerkverzoeken", () => {
    const fouten = src.filter((f) => /\b(fetch|XMLHttpRequest|sendBeacon)\s*\(|new\s+WebSocket\s*\(|new\s+EventSource\s*\(/.test(readFileSync(f, "utf8")));
    expect(fouten).toEqual([]);
  });

  it("de frontend noemt geen domeinen van diensten (alleen Rust kent die)", () => {
    const fouten = src.filter((f) => /api\.supabase\.com|\.supabase\.co\b|api\.github\.com|api\.vercel\.com|googleapis|analytics|sentry|segment\.io|mixpanel/i.test(readFileSync(f, "utf8")));
    expect(fouten).toEqual([]);
  });

  it("de Tauri-rechten van het venster bevatten geen netwerk-, shell- of opener-rechten", () => {
    const dir = path.resolve(__dirname, "../src-tauri/capabilities");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { permissions: (string | { identifier: string })[] };
      const ids = c.permissions.map((p) => (typeof p === "string" ? p : p.identifier));
      expect(ids.filter((i) => /^(http|shell|opener|fs|process|os):/.test(i)), f).toEqual([]);
      expect(ids.every((i) => /^(core:default|dialog:allow-(open|save))$/.test(i)), `${f}: ${ids.join(",")}`).toBe(true);
    }
  });
});

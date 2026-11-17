// Studio kit-check: zoekt in broncode naar dingen die niet bij de gekozen kit passen.
// Eén bestand zonder afhankelijkheden: Studio gebruikt het zelf én het wordt als design/kit-scan.mjs in het project gezet,
// zodat ook ESLint (design/eslint-kit.mjs) dezelfde regels draait.

/** Bestanden waar de regels voor gelden. */
export const SCAN_EXT = /\.(?:tsx?|jsx?|css|scss)$/i;
/** Wat nooit gecontroleerd wordt: de kit zelf, afhankelijkheden, uitvoer en tests. */
export const SKIP = /(?:^|\/)(?:node_modules|dist|build|coverage|\.git|kit|design)\/|\.(?:test|spec|stories)\.[a-z]+$|\.d\.ts$/i;

const NATIVE_TEXT = {
  button: "een knop",
  input: "een invoerveld",
  select: "een keuzelijst",
  textarea: "een tekstvak",
  dialog: "een dialoog",
};

/** Haalt commentaar weg maar behoudt regelnummers en kolommen. */
export function stripComments(text, isCss) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  if (!isCss) out = out.replace(/^([ \t]*)\/\/.*$/gm, (_, ws) => ws);
  return out;
}

/**
 * @param {string} file relatief pad met /
 * @param {string} text
 * @param {{ vervangNative?: Record<string,string>, verbodenImports?: string[] }} cfg
 * @returns {{file:string,line:number,col:number,rule:string,message:string,fix:string}[]}
 */
export function scanSource(file, text, cfg = {}) {
  if (!SCAN_EXT.test(file) || SKIP.test(file)) return [];
  const isCss = /\.s?css$/i.test(file);
  const isJsx = /\.(?:tsx|jsx)$/i.test(file);
  const clean = stripComments(text, isCss);
  const lines = clean.split("\n");
  const out = [];
  const add = (i, col, rule, message, fix) => out.push({ file, line: i + 1, col: col + 1, rule, message, fix });
  lines.forEach((line, i) => {
    // 1. Losse kleuren
    for (const m of line.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g)) {
      if (/^#\d+$/.test(m[0]) && !/[:(,"'`=]/.test(line[m.index - 1] ?? "")) continue; // "#123" in gewone tekst
      if (/href\s*=\s*["']#/.test(line.slice(Math.max(0, m.index - 12), m.index + 1))) continue; // anker-link
      add(i, m.index, "kleur", `Losse kleur ${m[0]}. Gebruik een kleur uit de kit.`, "Vervang deze kleur door een token of een kitcomponent met een kleurvariant.");
    }
    for (const m of line.matchAll(/\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(\s*[\d.]/gi)) {
      add(i, m.index, "kleur", `Losse kleur ${m[0].slice(0, -1)}(…). Gebruik een kleur uit de kit.`, "Vervang deze kleur door een token of een kitcomponent met een kleurvariant.");
    }
    // 2. Losse pixelwaarden (1px en 0px mogen, ook in mediaqueries)
    if (!/@media|@container|@supports|min-width|max-width\s*:\s*\(/.test(line)) {
      for (const m of line.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g)) {
        if (m[1] === "0" || m[1] === "1") continue;
        add(i, m.index, "pixels", `Losse pixelwaarde ${m[0]}. Gebruik de ruimte en rondingen van de kit.`, "Vervang deze waarde door een token (var(--…)) of een kitcomponent met de juiste ruimte.");
      }
    }
    // 3. Los lettertype
    const f = line.match(/\b(?:font-family|fontFamily)\s*:\s*(?!var\()([^;,}]+)/);
    if (f) add(i, f.index, "lettertype", "Los lettertype. Het lettertype komt uit de kit.", "Verwijder de lettertype-instelling; de kit regelt dit.");
    // 4. Native elementen waar de kit een component voor heeft
    if (isJsx) {
      for (const m of line.matchAll(/<(button|input|select|textarea|dialog)(?=[\s>/])/g)) {
        const comp = cfg.vervangNative?.[m[1]];
        if (!comp) continue;
        add(i, m.index, "native", `Gewone <${m[1]}> (${NATIVE_TEXT[m[1]]}) terwijl de kit <${comp}> heeft.`, `Gebruik <${comp}> uit de kit.`);
      }
    }
    // 5. Andere UI-bibliotheken
    const imp = line.match(/(?:\bfrom\s+|\bimport\s+|\brequire\()\s*["']([^"']+)["']/);
    if (imp) {
      const bad = (cfg.verbodenImports ?? []).find((p) => imp[1] === p || imp[1].startsWith(p.endsWith("/") ? p : p + "/") || (p.endsWith("/") && imp[1].startsWith(p)));
      if (bad) add(i, imp.index ?? 0, "bibliotheek", `Import uit een andere UI-bibliotheek (${imp[1]}).`, "Gebruik de componenten van de gekozen kit in plaats van deze bibliotheek.");
    }
  });
  return out;
}

export const RULE_TITLES = {
  kleur: "Losse kleuren",
  pixels: "Losse pixelwaarden",
  lettertype: "Losse lettertypes",
  native: "Gewone HTML-onderdelen",
  bibliotheek: "Andere UI-bibliotheken",
};

import type { Kit, Tokens } from "./schema.js";

/** Haalt een waarde op via een pad als "kleuren.licht.primair". */
export function resolveToken(tokens: Tokens, tokenPath: string): string {
  let cur: unknown = tokens;
  for (const part of tokenPath.split(".")) {
    if (typeof cur !== "object" || cur === null || !(part in cur)) throw new Error(`Token "${tokenPath}" bestaat niet.`);
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur !== "string" && typeof cur !== "number") throw new Error(`Token "${tokenPath}" is geen waarde.`);
  return String(cur);
}

/** CSS-waarden mogen nooit uit de regel breken (kit-bestanden zijn data, geen code). */
function safeCss(v: string): string {
  if (/[;{}<>\\\n\r]|\/\*/.test(v)) throw new Error(`Ongeldige tokenwaarde: ${JSON.stringify(v)}`);
  return v;
}

/** Genereert `src/kit/tokens.css` uit de tokens van het project. */
export function toCss(kit: Kit, tokens: Tokens): string {
  const block = (sel: string, map: Record<string, string>) => {
    const lines = Object.entries(map).map(([name, p]) => {
      if (!/^--[a-z0-9-]+$/.test(name)) throw new Error(`Ongeldige CSS-variabele: ${name}`);
      return `  ${name}: ${safeCss(resolveToken(tokens, p))};`;
    });
    return lines.length ? `${sel} {\n${lines.join("\n")}\n}\n` : "";
  };
  return [
    "/* Gemaakt door Studio uit design/tokens.json. Pas dat bestand aan (of gebruik Uiterlijk in Studio), niet dit bestand. */",
    block(":root", kit.setup.tokenMap),
    block('[data-theme="dark"]', kit.setup.tokenMapDonker),
  ]
    .filter(Boolean)
    .join("\n");
}

const RADIUS = {
  scherp: { klein: "2px", midden: "4px", groot: "6px" },
  gemiddeld: { klein: "4px", midden: "8px", groot: "12px" },
  rond: { klein: "8px", midden: "16px", groot: "28px" },
} as const;
const SCALE = { compact: 0.875, normaal: 1, ruim: 1.15 } as const;

export interface Tailor {
  hoofdkleur?: string;
  afronding?: "scherp" | "gemiddeld" | "rond";
  ruimte?: "compact" | "normaal" | "ruim";
  lettertype?: string;
}

const FONT_OK = /^[A-Za-z0-9 ,'"_-]{1,120}$/;

/** Past de gekozen instellingen toe op (een kopie van) de tokens. */
export function tailorTokens(tokens: Tokens, t: Tailor): Tokens {
  const out: Tokens = structuredClone(tokens);
  if (t.hoofdkleur !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(t.hoofdkleur)) throw new Error("De hoofdkleur moet er zo uitzien: #3d5ae8.");
    out.kleuren.licht.primair = t.hoofdkleur.toLowerCase();
    out.kleuren.donker.primair = t.hoofdkleur.toLowerCase();
  }
  if (t.afronding !== undefined) {
    if (!(t.afronding in RADIUS)) throw new Error("Kies scherp, gemiddeld of rond.");
    out.rondingen = { ...RADIUS[t.afronding] };
    out.instellingen = { ...out.instellingen, afronding: t.afronding };
  }
  if (t.ruimte !== undefined) {
    if (!(t.ruimte in SCALE)) throw new Error("Kies compact, normaal of ruim.");
    out.spacing.schaal = SCALE[t.ruimte];
    out.instellingen = { ...out.instellingen, ruimte: t.ruimte };
  }
  if (t.lettertype !== undefined) {
    if (!FONT_OK.test(t.lettertype)) throw new Error("Dit lettertype kan ik niet gebruiken. Gebruik alleen letters, cijfers, spaties en komma's.");
    out.typografie.lettertype = t.lettertype;
  }
  return out;
}

/** Flutter: een ThemeData-bestand uit dezelfde tokens. */
export function toFlutter(tokens: Tokens): string {
  const c = tokens.kleuren;
  const col = (h: string) => `Color(0xFF${h.slice(1).toUpperCase()})`;
  const num = (px: string) => (parseFloat(px) || 0).toFixed(1);
  const scheme = (k: "licht" | "donker") => `ColorScheme.${k === "licht" ? "light" : "dark"}(
      primary: ${col(c[k].primair)},
      surface: ${col(c[k].achtergrond)},
      onSurface: ${col(c[k].tekst)},
      outline: ${col(c[k].rand)},
      error: ${col(c[k].gevaar)},
    )`;
  const font = tokens.typografie.lettertype.split(",")[0].replace(/['"]/g, "").trim();
  return `// Gemaakt door Studio uit design/tokens.json. Pas dat bestand aan, niet dit bestand.
import 'package:flutter/material.dart';

class AppTheme {
  static const double radiusKlein = ${num(tokens.rondingen.klein)};
  static const double radiusMidden = ${num(tokens.rondingen.midden)};
  static const double radiusGroot = ${num(tokens.rondingen.groot)};
  static const double ruimteSchaal = ${tokens.spacing.schaal};

  static ThemeData _build(ColorScheme scheme) => ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        fontFamily: '${font}',
        cardTheme: CardThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusGroot))),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusMidden))),
        ),
        inputDecorationTheme: InputDecorationTheme(border: OutlineInputBorder(borderRadius: BorderRadius.circular(radiusMidden))),
      );

  static ThemeData licht() => _build(${scheme("licht")});
  static ThemeData donker() => _build(${scheme("donker")});
}
`;
}

import { z } from "zod";

/** Licenties waarmee een kit toegestaan is. Alles anders wordt geweigerd. */
export const ALLOWED_LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"] as const;

export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const exactVersion = z.string().regex(EXACT_VERSION, "Moet een exacte versie zijn, bijvoorbeeld 4.5.0 (geen ^, ~ of latest).");
const npmName = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, "Geen geldige pakketnaam.");

export const KitSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "Alleen kleine letters, cijfers en streepjes (2-40 tekens)."),
    naam: z.string().min(2).max(60),
    beschrijving: z.string().min(10).max(300),
    /** Korte etiket op de kaart, bijv. "Snel en goedkoop". */
    label: z.string().min(2).max(40),
    type: z.enum(["npm", "bestanden"]),
    pakketnaam: npmName.optional(),
    versie: exactVersion.optional(),
    /** Extra pakketten die de kit nodig heeft (ook exact vastgezet). */
    extraPakketten: z.array(z.object({ naam: npmName, versie: exactVersion }).strict()).default([]),
    bron: z.url(),
    /** SPDX-id. Alleen ALLOWED_LICENSES worden toegepast. */
    licentie: z.string().min(2),
    attributie: z.object({ verplicht: z.boolean(), tekst: z.string() }).strict(),
    /** Stacks waarvoor de kit geschikt is: "react-vite", "flutter", … */
    stacks: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
    /** Uitleg in gewoon Nederlands: wat er bij het toepassen gebeurt. */
    installatiestappen: z.array(z.string().min(3)).min(1),
    /** Draait het pakket (of iets in de boom) installatiescripts? Dan vraagt Studio eerst bevestiging. */
    installatiescripts: z.boolean().default(false),
    setup: z
      .object({
        uitvoer: z.enum(["css", "dart"]),
        stijlImports: z.array(z.string()).default([]),
        provider: z.object({ pakket: z.string(), naam: z.string(), props: z.record(z.string(), z.string()).default({}) }).strict().nullable().default(null),
        /** CSS-variabele → tokenpad (licht). */
        tokenMap: z.record(z.string(), z.string()).default({}),
        /** CSS-variabele → tokenpad (donker). */
        tokenMapDonker: z.record(z.string(), z.string()).default({}),
        rootAttributen: z.record(z.string(), z.string()).default({}),
      })
      .strict(),
    tokens: z.string().default("tokens.json"),
    kitcontext: z
      .object({
        catalogus: z.enum(["fragments-json", "typings", "bestanden"]),
        maxTokens: z.number().int().min(500).max(20000).default(6000),
        importPad: z.string(),
        /** Componenten die een pagina of formulier het vaakst nodig heeft: die krijgen in de catalogus altijd de meeste details. */
        kern: z.array(z.string()).default([]),
      })
      .strict(),
    /** Alleen bij type "bestanden": map met componenten, relatief aan design-packs/. */
    componenten: z.string().optional(),
    regels: z.string().default("rules.md"),
    preview: z.string().default("preview.png"),
    voorbeeld: z.string().default("voorbeeld.tsx"),
    kitCheck: z
      .object({
        /** Native element → kitcomponent, bijv. { "button": "Button" }. */
        vervangNative: z.record(z.string(), z.string()).default({}),
        /** Imports uit andere UI-bibliotheken die niet mogen. */
        verbodenImports: z.array(z.string()).default([]),
      })
      .strict()
      .default({ vervangNative: {}, verbodenImports: [] }),
  })
  .strict()
  .superRefine((k, ctx) => {
    if (k.type === "npm") {
      if (!k.pakketnaam) ctx.addIssue({ code: "custom", path: ["pakketnaam"], message: "Bij type npm is een pakketnaam verplicht." });
      if (!k.versie) ctx.addIssue({ code: "custom", path: ["versie"], message: "Bij type npm is een exacte versie verplicht." });
    } else if (!k.componenten) {
      ctx.addIssue({ code: "custom", path: ["componenten"], message: "Bij type bestanden is een componenten-map verplicht." });
    }
    if (k.attributie.verplicht && !k.attributie.tekst.trim()) {
      ctx.addIssue({ code: "custom", path: ["attributie", "tekst"], message: "Verplichte attributie heeft een tekst nodig." });
    }
  });

export type Kit = z.infer<typeof KitSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Gebruik een kleur als #3d5ae8.");
const palette = z
  .object({ primair: hex, achtergrond: hex, tekst: hex, rand: hex, succes: hex, gevaar: hex, waarschuwing: hex })
  .strict();

export const TokensSchema = z
  .object({
    kleuren: z.object({ licht: palette, donker: palette }).strict(),
    rondingen: z.object({ klein: z.string(), midden: z.string(), groot: z.string() }).strict(),
    spacing: z.object({ schaal: z.number().min(0.5).max(2), eenheid: z.string() }).strict(),
    schaduw: z.object({ klein: z.string(), midden: z.string(), groot: z.string() }).strict(),
    typografie: z.object({ lettertype: z.string().min(1), koplettertype: z.string().optional(), basisgrootte: z.string() }).strict(),
    /** De gekozen instellingen (voor "Aanpassen zonder AI"); ontbreken = zoals de kit het levert. */
    instellingen: z
      .object({
        afronding: z.enum(["scherp", "gemiddeld", "rond"]).optional(),
        ruimte: z.enum(["compact", "normaal", "ruim"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Tokens = z.infer<typeof TokensSchema>;

export function kitJsonSchema(): unknown {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Studio kit.json", ...(z.toJSONSchema(KitSchema, { io: "input" }) as object) };
}

export function tokensJsonSchema(): unknown {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Studio tokens.json", ...(z.toJSONSchema(TokensSchema, { io: "input" }) as object) };
}

export function isAllowedLicense(spdx: string): boolean {
  return (ALLOWED_LICENSES as readonly string[]).includes(spdx);
}

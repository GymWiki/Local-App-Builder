// Acceptatietest als totale beginner: drie volledige scenario's, nooit via een terminal, in de echte frontend met de nagebootste Tauri-laag.
//   A: schone installatie → eerste start → AI koppelen → project uit voorbeeld → tien wijzigingen in de chat
//   B: eigen idee → plan → uiterlijk → bouwen → online zetten (eerst voorbeeld, dan echt met bevestiging)
//   C: telefoon-app naar de winkelvoorbereiding: gegevens, teksten, export (er wordt niets ingediend)
//   D: foutsituaties: geen internet, AI niet ingelogd, AI loopt vast, volle schijf, sluiten tijdens bouwen, tweede project tegelijk
// Meet per stap: klikken, wachttijd, Engelse of vaktaalwoorden op het scherm, scriptfouten. Schrijft docs/ux/beginner/*.json.
// Gebruik: node scripts/ux-beginner-test.mjs [A|B|C|D]   (zonder argument: alles)
import { mkdirSync, writeFileSync } from "node:fs";
import { openApp, stop, measure } from "./ux-sim.mjs";

const welke = (process.argv[2] ?? "ABCD").toUpperCase();
const ALLE = [[1280, 720], [1366, 768], [1920, 1080]];
const FORMATEN = process.env.ONLY ? ALLE.filter(([w, h]) => `${w}x${h}` === process.env.ONLY) : ALLE;
const UIT = "docs/ux/beginner";
mkdirSync(UIT, { recursive: true });
const rapport = [];
const VAKTAAL = /\b(preview|deploy\w*|checkpoint\w*|commit\w*|rollback|token\w*|mcp|database|stderr|stdout|exception|undefined|null)\b/i;

class Beginner {
  constructor(naam, page, errors) {
    Object.assign(this, { naam, p: page, errors, klikken: 0, stappen: [], blokkades: [], twijfel: [], wachten: 0, t0: Date.now() });
  }
  async klik(loc, wat) {
    await loc.waitFor({ timeout: 4000 });
    await loc.click();
    this.klikken++;
    this.laatste = wat;
  }
  /** Een stap die mag mislukken: een mislukte stap is een bevinding (blokkade), geen crash van de test. */
  async stap(naam, fn) {
    const start = Date.now();
    try {
      await fn();
      this.stappen.push({ naam, ok: true, ms: Date.now() - start });
      return true;
    } catch (e) {
      this.blokkades.push(`${naam}: ${String(e.message).split("\n")[0].slice(0, 160)}`);
      this.stappen.push({ naam, ok: false, ms: Date.now() - start });
      return false;
    }
  }
  /** Is het zichtbaar wat je nu moet doen? Er moet precies één opvallende primaire knop zichtbaar zijn (of een duidelijke tekst). */
  async volgendeStapDuidelijk(naam, selector) {
    const n = await this.p.locator(selector).filter({ visible: true }).count();
    if (n === 0) this.twijfel.push(`${naam}: geen duidelijke volgende stap (${selector} niet zichtbaar)`);
  }
  async meet(naam) {
    const m = await this.p.evaluate(measure);
    const tekst = await this.p.locator("body").innerText();
    const vak = [...new Set((tekst.match(new RegExp(VAKTAAL.source, "gi")) ?? []).map((x) => x.toLowerCase()))];
    // vaktaal in de gewone weergave is een bevinding, behalve onder "Voor gevorderden"
    if (vak.length) this.twijfel.push(`${naam}: vaktaal zichtbaar: ${vak.join(", ")}`);
    for (const k of ["afgekapt", "buitenBeeld", "dubbeleScroll"]) if (m[k]?.length) this.twijfel.push(`${naam}: ${k}: ${m[k].slice(0, 3).join(" | ")}`);
    const hscroll = await this.p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (hscroll) this.twijfel.push(`${naam}: horizontaal scrollen`);
    return m;
  }
  klaar(extra = {}) {
    const r = { scenario: this.naam, klikken: this.klikken, seconden: Math.round((Date.now() - this.t0) / 100) / 10, stappen: this.stappen, blokkades: this.blokkades, twijfel: [...new Set(this.twijfel)], scriptfouten: this.errors.slice(0, 5), ...extra };
    rapport.push(r);
    return r;
  }
}

async function nieuwProject(b, { soort, naam }) {
  const p = b.p;
  await b.stap(`nieuw project (${soort})`, async () => {
    await b.klik(p.getByRole("button", { name: /Nieuw project|Maak je eerste project/ }).first(), "Nieuw project");
    await p.locator("#nieuw-naam").fill(naam, { timeout: 5000 });
    await b.klik(p.locator(`#soort-${soort}`), `soort ${soort}`);
    await b.klik(p.getByRole("button", { name: "Map kiezen…" }), "Map kiezen");
    await b.klik(p.getByRole("button", { name: "Project aanmaken" }), "Project aanmaken");
    await p.getByTestId("menu").waitFor({ timeout: 6000 });
  });
}

async function stuur(b, tekst, verwacht = "Klaar!") {
  const p = b.p;
  const voor = await p.getByText(verwacht).count();
  const veld = p.getByRole("textbox").last();
  await veld.fill(tekst);
  await veld.press("Enter");
  b.klikken++; // versturen telt als één handeling
  const start = Date.now();
  // Wachten tot er een NIEUW antwoord is (niet het vorige).
  await p.waitForFunction(([t, n]) => [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent.includes(t)).length > n, [verwacht, voor], { timeout: 12000 });
  b.wachten += Date.now() - start;
}

// ------------------------------------------------------------------ A
async function scenarioA(w, h, theme) {
  const { page: p, ctx, errors } = await openApp({ w, h, theme, scenario: { eersteStart: true } });
  const b = new Beginner(`A ${w}x${h} ${theme}`, p, errors);
  await b.stap("eerste start: welkom", async () => {
    await p.getByTestId("eerste-welkom").waitFor();
    await b.volgendeStapDuidelijk("welkom", "[data-testid=eerste-volgende]");
    await b.meet("welkom");
    await b.klik(p.getByTestId("eerste-volgende"), "Volgende");
  });
  await b.stap("eerste start: AI kiezen en inloggen", async () => {
    await p.getByTestId("eerste-ai").waitFor();
    await b.klik(p.getByTestId("eerste-ai").getByRole("button", { name: "Inloggen" }).first(), "Inloggen Claude");
    await b.klik(p.getByRole("button", { name: "Klaar" }), "Klaar met inloggen");
    await b.meet("AI kiezen");
    await b.klik(p.getByTestId("eerste-volgende"), "Volgende");
  });
  await b.stap("eerste start: bedieningsniveau en afronden", async () => {
    await b.meet("niveau");
    await b.klik(p.getByTestId("eerste-klaar"), "Klaar");
    await p.getByTestId("eerste-start").waitFor({ state: "detached", timeout: 3000 });
  });
  await nieuwProject(b, { soort: "start-takenlijst", naam: "Mijn takenlijst" });
  await b.stap("route-balk en chat zichtbaar", async () => {
    await p.getByTestId("route-balk").waitFor();
    await b.meet("werkruimte");
  });
  const wensen = ["Maak de kop groter", "Voeg een tweede pagina toe", "Maak de knop blauw", "Zet de tekst in het midden", "Voeg een contactknop toe", "Maak de achtergrond lichter", "Verander de titel", "Voeg een voettekst toe", "Maak de knoppen groter", "Voeg een logo toe"];
  let gelukt = 0;
  for (const [i, wens] of wensen.entries()) {
    if (await b.stap(`chat ${i + 1}: ${wens}`, () => stuur(b, wens))) gelukt++;
  }
  await b.stap("na tien wijzigingen: versies bewaard en voorbeeld zichtbaar", async () => {
    const aantal = await p.evaluate(() => (window.__S.versions[1] ?? []).length);
    if (aantal < 1) throw new Error(`geen versie bewaard (${aantal})`);
    await b.meet("na tien wijzigingen");
  });
  const r = b.klaar({ gelukteWijzigingen: gelukt, wachtMsInChat: b.wachten });
  await ctx.close();
  return r;
}

// ------------------------------------------------------------------ B
async function scenarioB(w, h, theme) {
  const seed = [];
  const { page: p, ctx, errors } = await openApp({ w, h, theme, scenario: { seed, connStatus: { vercel: "werkt" }, vercel: { project: "mijn-site" } } });
  const b = new Beginner(`B ${w}x${h} ${theme}`, p, errors);
  await nieuwProject(b, { soort: "leeg", naam: "Hovenier Joke" });
  await b.stap("idee: route-balk toont de eerste stap", async () => {
    await p.getByTestId("route-balk").waitFor();
    await b.volgendeStapDuidelijk("idee", "[data-testid=route-volgende]");
    await b.meet("route idee");
  });
  await b.stap("idee beschrijven", async () => {
    await b.klik(p.getByTestId("route-volgende"), "route volgende (idee)");
    await p.getByTestId("idee-dialoog").waitFor();
    await p.getByTestId("idee-tekst").fill("Een website voor mijn hoveniersbedrijf met foto's en een contactformulier");
    await b.meet("idee-dialoog");
    await b.klik(p.getByTestId("idee-stuur"), "idee versturen");
    await p.getByText("Klaar!").last().waitFor({ timeout: 15000 });
  });
  await b.stap("route gaat verder na het idee", async () => {
    const huidig = await p.getByTestId("route-balk").getAttribute("data-huidig").catch(() => null);
    await b.meet("route na idee");
    if (!huidig) throw new Error("route-balk heeft geen huidige stap");
  });
  await b.stap("uiterlijk kiezen", async () => {
    await b.klik(p.getByTestId("menu-uiterlijk"), "menu Uiterlijk");
    await p.waitForTimeout(500);
    await b.meet("uiterlijk");
  });
  await b.stap("bouwen en aanpassen in de chat", async () => {
    await b.klik(p.getByTestId("menu-start"), "menu Start");
    await stuur(b, "Maak de kop groen en voeg mijn telefoonnummer toe");
    await b.meet("na bouwen");
  });
  await b.stap("online zetten: voorbeeld en echt met bevestiging", async () => {
    await b.klik(p.getByTestId("menu-onlinezetten"), "menu Online zetten");
    await p.getByTestId("vercel-online").waitFor();
    await b.meet("online zetten");
  });
  const r = b.klaar();
  await ctx.close();
  return r;
}

// ------------------------------------------------------------------ C
async function scenarioC(w, h, theme) {
  const { page: p, ctx, errors } = await openApp({ w, h, theme, scenario: { seed: [{ naam: "Kassa-app", last: "2026-11-10T10:00:00Z" }] } });
  const b = new Beginner(`C ${w}x${h} ${theme}`, p, errors);
  await b.stap("project openen", async () => {
    await b.klik(p.getByRole("button", { name: "Open Kassa-app" }), "Open project");
    await p.getByTestId("menu").waitFor();
  });
  await b.stap("In de appwinkel openen", async () => {
    await b.klik(p.getByTestId("menu-appwinkel"), "menu In de appwinkel");
    await p.waitForTimeout(600);
    await b.meet("appwinkel");
  });
  await b.stap("winkelstappen zichtbaar en niets wordt ingediend", async () => {
    const tekst = await p.locator("body").innerText();
    if (!/Google Play|Play Store/i.test(tekst) || !/App Store/i.test(tekst)) throw new Error("beide winkels niet te zien");
    if (await p.evaluate(() => (window.__S.ingediend ?? []).length)) throw new Error("er is iets ingediend");
  });
  await b.stap("exporteren als zip", async () => {
    await b.klik(p.getByTestId("menu-bestanden"), "menu Bestanden");
    await p.waitForTimeout(500);
    await b.meet("bestanden");
  });
  const r = b.klaar();
  await ctx.close();
  return r;
}

// ------------------------------------------------------------------ D
async function scenarioD() {
  const gevallen = [
    ["geen internet", { offline: true }, "Geen verbinding"],
    ["AI niet ingelogd", { notLoggedIn: true }, "ingelogd"],
  ];
  for (const [naam, scen, woord] of gevallen) {
    const { page: p, ctx, errors } = await openApp({ w: 1366, h: 768, theme: "licht", scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }], ...scen } });
    const b = new Beginner(`D ${naam}`, p, errors);
    await b.stap("open en stuur een bericht", async () => {
      await b.klik(p.getByRole("button", { name: "Open Hovenier Joke" }), "open");
      await p.getByTestId("menu").waitFor();
      const veld = p.getByRole("textbox").last();
      await veld.fill("Maak de kop groter");
      await veld.press("Enter");
      await p.getByText(new RegExp(woord, "i")).first().waitFor({ timeout: 8000 });
    });
    await b.stap("foutmelding begrijpelijk en met een herstelroute", async () => {
      const tekst = await p.locator("body").innerText();
      if (/getaddrinfo|ENOTFOUND|Please run \/login|undefined/.test(tekst.split("Toon details")[0])) throw new Error("technische tekst staat in de gewone weergave");
      const knoppen = await p.getByRole("button").allInnerTexts();
      if (!knoppen.some((k) => /opnieuw|inloggen|AI-accounts|probeer/i.test(k))) throw new Error(`geen herstelknop (${knoppen.slice(0, 8).join(" ; ")})`);
      await b.meet(naam);
    });
    b.klaar();
    await ctx.close();
  }
  // Volle schijf: begrijpelijke melding met oplossing; technische tekst alleen achter "Toon details".
  {
    const { page: p, ctx, errors } = await openApp({ w: 1366, h: 768, theme: "licht", scenario: { seed: [], schijfVol: true } });
    const b = new Beginner("D volle schijf", p, errors);
    await b.stap("project aanmaken geeft een begrijpelijke melding", async () => {
      await b.klik(p.getByRole("button", { name: /Nieuw project|Maak je eerste project/ }).first(), "Nieuw project");
      await p.locator("#nieuw-naam").fill("Test");
      await b.klik(p.getByRole("button", { name: "Map kiezen…" }), "Map kiezen");
      await b.klik(p.getByRole("button", { name: "Project aanmaken" }), "Project aanmaken");
      const banner = p.getByTestId("fout-banner");
      await banner.waitFor({ timeout: 5000 });
      const tekst = await banner.innerText();
      if (!/Je computer zit vol/.test(tekst)) throw new Error(`verkeerde melding: ${tekst.slice(0, 100)}`);
      if (/os error 28|No space left/.test(tekst.split("Toon details")[0])) throw new Error("technische tekst staat in de gewone weergave");
      await b.klik(p.getByTestId("fout-details-knop"), "Toon details");
      if (!/No space left/.test(await p.getByTestId("fout-details").innerText())) throw new Error("details ontbreken");
    });
    b.klaar();
    await ctx.close();
  }
  // De AI loopt vast: vriendelijke pauze met vier keuzes (geen technische tekst).
  {
    const { page: p, ctx, errors } = await openApp({ w: 1366, h: 768, theme: "licht", scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] } });
    const b = new Beginner("D AI loopt vast", p, errors);
    await b.stap("pauzekaart met keuzes", async () => {
      await p.evaluate(() => (window.__S.messages[1] = [{ id: 901, project_id: 1, kind: "loop_alert", payload: { reason: "rewrites", streak: 6, threshold: 3, last_working: null, escalated: true }, created_at: new Date().toISOString() }]));
      await b.klik(p.getByRole("button", { name: "Open Hovenier Joke" }), "open");
      const kaart = p.getByTestId("loop-alert");
      await kaart.waitFor({ timeout: 5000 });
      for (const k of ["Probeer een andere aanpak", "Eerst alleen onderzoeken", "Andere AI proberen"]) if (!(await kaart.getByRole("button", { name: k }).count())) throw new Error(`knop ontbreekt: ${k}`);
      await b.meet("AI loopt vast");
    });
    b.klaar();
    await ctx.close();
  }
  // Sluiten tijdens een bouwactie: terug naar de lijst en weer openen zonder fouten of een vastzittende status.
  {
    const { page: p, ctx, errors } = await openApp({ w: 1366, h: 768, theme: "licht", scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] } });
    const b = new Beginner("D sluiten tijdens bouwen", p, errors);
    await b.stap("sluiten midden in een bouwactie en weer openen", async () => {
      await b.klik(p.getByRole("button", { name: "Open Hovenier Joke" }), "open");
      await p.getByTestId("menu").waitFor();
      const veld = p.getByRole("textbox").last();
      await veld.fill("Maak een mooie website");
      await veld.press("Enter");
      await p.waitForTimeout(1200);
      await b.klik(p.getByTestId("menu-terug"), "terug tijdens bouwen");
      await p.getByTestId("home").waitFor({ timeout: 5000 });
      await b.klik(p.getByRole("button", { name: "Open Hovenier Joke" }), "weer openen");
      await p.getByTestId("menu").waitFor();
    });
    b.klaar();
    await ctx.close();
  }
  // Tweede project tegelijk: twee projecten openen na elkaar zonder dat het eerste kapotgaat.
  {
    const { page: p, ctx, errors } = await openApp({ w: 1366, h: 768, theme: "licht", scenario: { seed: [{ naam: "Eerste", last: "2026-11-10T10:00:00Z" }, { naam: "Tweede", last: "2026-11-09T10:00:00Z" }] } });
    const b = new Beginner("D tweede project tegelijk", p, errors);
    await b.stap("twee projecten achter elkaar openen", async () => {
      await b.klik(p.getByRole("button", { name: "Open Eerste" }), "open eerste");
      await p.getByTestId("menu").waitFor();
      await b.klik(p.getByTestId("menu-terug"), "terug");
      await b.klik(p.getByRole("button", { name: "Open Tweede" }), "open tweede");
      await p.getByTestId("menu").waitFor();
    });
    b.klaar();
    await ctx.close();
  }
}

try {
  if (welke.includes("A")) for (const [w, h] of FORMATEN) for (const th of w === 1366 ? ["licht", "donker"] : ["licht"]) await scenarioA(w, h, th);
  if (welke.includes("B")) for (const [w, h] of FORMATEN) for (const th of w === 1366 ? ["licht", "donker"] : ["licht"]) await scenarioB(w, h, th);
  if (welke.includes("C")) for (const [w, h] of FORMATEN) for (const th of w === 1366 ? ["licht", "donker"] : ["licht"]) await scenarioC(w, h, th);
  if (welke.includes("D")) await scenarioD();
} finally {
  await stop();
}
writeFileSync(`${UIT}/resultaat-${welke}${process.env.ONLY ? `-${process.env.ONLY}` : ""}.json`, JSON.stringify(rapport, null, 1));
let slecht = 0;
for (const r of rapport) {
  const ok = r.blokkades.length === 0 && r.scriptfouten.length === 0;
  if (!ok) slecht++;
  console.log(`${ok ? "✔" : "✘"} ${r.scenario}: ${r.klikken} klikken, ${r.seconden}s${r.blokkades.length ? `\n   blokkades: ${r.blokkades.join(" | ")}` : ""}${r.scriptfouten.length ? `\n   scriptfouten: ${r.scriptfouten.join(" | ")}` : ""}`);
  for (const t of r.twijfel) console.log(`   · ${t}`);
}
process.exit(slecht ? 1 : 0);

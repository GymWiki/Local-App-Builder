// Playwright-test voor Online zetten met Vercel: node scripts/ux-vercel-test.mjs
// Nagebootste Tauri-laag. Controleert de stappen, Verbinden, voorbeeld, de bevestiging voor echt online zetten, fouten, variabelen en eerdere versies.
import { mkdirSync } from "node:fs";
import { openApp, stop } from "./ux-sim.mjs";

const ALLE = [
  ["1280x720", 1280, 720],
  ["1366x768", 1366, 768],
  ["1920x1080", 1920, 1080],
];
const FORMATEN = process.env.ONLY ? ALLE.filter((f) => f[0] === process.env.ONLY) : ALLE;
const OUT = "docs/ui";
mkdirSync(OUT, { recursive: true });
const fouten = [];
const check = (naam, ok, extra = "") => {
  if (!ok) fouten.push(`${naam}${extra ? ` (${extra})` : ""}`);
};
const geenHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const seed = { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] };

async function naarOnline(p) {
  await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
  await p.waitForSelector("[data-testid=menu]");
  await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
  await p.waitForTimeout(500);
  await p.getByTestId("menu-onlinezetten").click();
  await p.getByTestId("vercel-online").waitFor();
}
const stap = (p, id) => p.getByTestId("online-stappen").locator(`[data-stap=${id}]`);

try {
  for (const [naam, w, h] of FORMATEN) {
    const t = (s) => `${naam}: ${s}`;

    // ---- Niet gekoppeld: de volgende stap is Verbinden; daarna een voorbeeld; daarna echt online met bevestiging
    {
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: { ...seed, vercel: { ontbrekend: [] } } });
      await naarOnline(p);
      // Er zijn nog geen versies in de nagebootste wereld: de eerste stap vraagt om controles.
      check(t("vijf stappen staan er"), (await p.getByTestId("online-stappen").locator("li").count()) === 5);
      await p.evaluate(() => window.__connectDone("vercel"));
      await p.waitForTimeout(300);
      check(t("na verbinden is stap 2 klaar"), (await stap(p, "gekoppeld").getAttribute("data-klaar")) === "ja");
      check(t("voorwaarden van het gratis plan worden genoemd"), /Lees ze op vercel\.com/.test(await p.getByTestId("vercel-voorwaarden").innerText()));
      check(t("geen horizontale scroll"), await geenHScroll(p));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Gekoppeld met groene controles (versies bestaan): voorbeeld, live met bevestiging, eerdere versies
    {
      const versies = [
        { id: "dpl_3", adres: "c.vercel.app", doel: "production", status: "READY", gemaakt: 1_763_460_000, versie: "abc1234" },
        { id: "dpl_2", adres: "b.vercel.app", doel: "production", status: "READY", gemaakt: 1_763_450_000, versie: "def5678" },
        { id: "dpl_1", adres: "a.vercel.app", doel: "preview", status: "ERROR", gemaakt: 1_763_440_000, versie: null },
      ];
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { vercel: "werkt" }, vercel: { project: "hovenier-joke" }, vercelVersies: versies } });
      // Een opgeslagen versie in de nagebootste wereld, vóór het project opent: dan gelden de controles als groen.
      await p.evaluate(() => (window.__S.versions[1] = [{ hash: "h1abcdef00", short: "h1abcde", date: new Date().toISOString(), message: "Eerste versie" }]));
      await naarOnline(p);
      const volgende = p.getByTestId("online-volgende");
      check(t("volgende stap is een voorbeeld online zetten"), (await volgende.getAttribute("data-stap")) === "voorbeeld", await volgende.getAttribute("data-stap"));
      await volgende.click();
      const uit = p.getByTestId("vercel-uitkomst");
      await uit.waitFor();
      check(t("voorbeeld: adres met kopiëren en openen"), /hovenier-joke-abc\.vercel\.app/.test(await p.getByTestId("vercel-adres").innerText()) && (await p.getByTestId("vercel-kopieer").isVisible()) && (await p.getByTestId("vercel-open").isVisible()));
      check(t("voorbeeld vroeg niets extra's"), (await p.evaluate(() => window.__S.vercelAanroepen)).every((a) => a[0] === "preview" && a[1] === false));
      await p.getByTestId("vercel-open").click();
      check(t("het adres wordt in de browser geopend"), (await p.evaluate(() => window.__S.opened)).some((u) => u.includes("hovenier-joke-abc.vercel.app")));
      await p.screenshot({ path: `${OUT}/vercel-online-${naam}.png` });

      // Echt online: dialoog, "Niet doen" stuurt niets, "Ja" stuurt bevestigd
      await p.getByTestId("online-volgende").click();
      const dlg = p.getByTestId("vercel-live-dialoog");
      await dlg.waitFor();
      check(t("bevestiging legt uit wat er gebeurt"), /iedereen op internet kan de nieuwe versie zien/.test(await dlg.innerText()) && /terug naar een eerdere versie/.test(await dlg.innerText()));
      await p.screenshot({ path: `${OUT}/vercel-live-bevestiging-${naam}.png` });
      await p.getByTestId("vercel-live-nee").click();
      await p.waitForTimeout(200);
      check(t("'Niet doen' stuurt niets"), !(await p.evaluate(() => window.__S.vercelAanroepen)).some((a) => a[0] === "live"));
      await p.getByTestId("online-volgende").click();
      await p.getByTestId("vercel-live-ja").click();
      await p.waitForFunction(() => window.__S.vercelAanroepen.some((a) => a[0] === "live" && a[1] === true));
      await p.getByTestId("vercel-uitkomst").waitFor();
      check(t("live: adres getoond"), /hovenier-joke\.vercel\.app/.test(await p.getByTestId("vercel-adres").innerText()));
      check(t("alle vijf stappen zijn klaar"), (await p.getByTestId("online-stappen").locator("[data-klaar=ja]").count()) === 5);

      // Eerdere versies: terugzetten vraagt bevestiging (niet voor de nieuwste)
      const lijst = p.getByTestId("vercel-versies");
      await lijst.waitFor();
      check(t("terug-knop alleen voor oudere echte versies"), (await lijst.getByTestId("vercel-terug").count()) === 1);
      await lijst.getByTestId("vercel-terug").click();
      await p.getByTestId("vercel-terug-dialoog").waitFor();
      await p.getByTestId("vercel-terug-ja").click();
      await p.waitForFunction(() => window.__S.vercelAanroepen.some((a) => a[0] === "terug" && a[1] === "dpl_2" && a[2] === true));
      check(t("geen horizontale scroll"), await geenHScroll(p));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Fouten: controles en mislukte bouw met "Laat de AI dit herstellen" (als laatste: de nagebootste AI springt naar het voorbeeld)
    {
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { vercel: "werkt" }, vercel: { project: "hovenier-joke" } } });
      await p.evaluate(() => (window.__S.versions[1] = [{ hash: "h1abcdef00", short: "h1abcde", date: new Date().toISOString(), message: "Eerste versie" }]));
      await naarOnline(p);
      await p.evaluate(() => (window.__S.vercelUitkomst = { status: "mislukt", code: "bouw_mislukt", params: { soort: "module_ontbreekt", regels: ["Error: Cannot find module 'leaflet'"] } }));
      await p.getByTestId("vercel-voorbeeld").click();
      const b = p.getByTestId("vercel-bouwfout");
      await b.waitFor();
      check(t("bouwfout in gewone taal"), /ontbreekt/.test(await b.innerText()));
      await b.getByRole("button", { name: "Laat de laatste regels zien" }).click();
      check(t("details tonen de laatste regels"), /Cannot find module/.test(await p.getByTestId("vercel-bouwregels").innerText()));
      await p.screenshot({ path: `${OUT}/vercel-bouwfout-${naam}.png` });
      await p.evaluate(() => (window.__S.vercelUitkomst = { status: "geweigerd", code: "controles", params: { problemen: [{ code: "geheimen", bestanden: [{ bestand: "src/a.ts", regel: 3, soort: "github_token" }] }] } }));
      await p.getByTestId("vercel-voorbeeld").click();
      await p.getByTestId("vercel-problemen").waitFor();
      await p.getByTestId("vercel-herstel").click();
      check(t("herstel stuurt de bestandsnamen naar de AI"), (await p.evaluate(() => window.__S.sent.at(-1) ?? "")).includes("src/a.ts"));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Variabelen en domein
    {
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { vercel: "werkt" }, vercel: { project: "hovenier-joke", ontbrekend: ["VITE_WINKEL_NAAM"] } } });
      await naarOnline(p);
      const v = p.getByTestId("vercel-variabelen");
      await v.scrollIntoViewIfNeeded();
      check(t("ontbrekende variabele wordt genoemd"), /VITE_WINKEL_NAAM/.test(await v.getByTestId("vercel-ontbrekend").innerText()));
      check(t("server is uit zonder serverdeel"), await v.getByRole("radio", { name: /Geheim \(server\)/ }).isDisabled());
      await v.getByTestId("vercel-env-naam").fill("VITE_WINKEL_NAAM");
      await v.getByTestId("vercel-env-waarde").fill("Joke");
      await v.getByRole("checkbox", { name: "Echte site" }).click();
      await v.getByTestId("vercel-env-opslaan").click();
      await v.getByTestId("vercel-env-melding").waitFor();
      check(t("variabele opgeslagen zonder de waarde te tonen"), (await v.getByTestId("vercel-env-lijst").innerText()).includes("VITE_WINKEL_NAAM") && !(await v.innerText()).includes("Joke"));
      check(t("ontbrekend verdwijnt"), (await v.getByTestId("vercel-ontbrekend").count()) === 0);
      // Een geheim als openbaar wordt geweigerd; voor de echte site eerst bevestigen
      await v.getByTestId("vercel-env-naam").fill("VITE_X");
      await v.getByTestId("vercel-env-waarde").fill("SECRET-sleutel");
      await v.getByRole("checkbox", { name: "Echte site" }).click();
      await v.getByTestId("vercel-env-opslaan").click();
      await p.getByTestId("vercel-env-dialoog").waitFor();
      await p.getByTestId("vercel-env-ja").click();
      await p.waitForTimeout(300);
      check(t("geheim als openbaar krijgt een duidelijke fout"), /geheime sleutel/.test(await v.getByTestId("vercel-env-melding").innerText()));
      // Domein
      const d = p.getByTestId("vercel-domein");
      await d.scrollIntoViewIfNeeded();
      await d.getByTestId("vercel-domein-naam").fill("mijnwinkel.nl");
      await d.getByTestId("vercel-domein-koppel").click();
      await d.getByTestId("vercel-domein-resultaat").waitFor();
      check(t("domein toont de gegevens van Vercel"), /_vercel\.mijnwinkel\.nl/.test(await d.innerText()) && /kopen kan hier niet/.test(await d.innerText()));
      await p.screenshot({ path: `${OUT}/vercel-variabelen-${naam}.png` });
      check(t("geen horizontale scroll"), await geenHScroll(p));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nVercel-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`Vercel-test: alles goed op ${FORMATEN.length} formaten.`);

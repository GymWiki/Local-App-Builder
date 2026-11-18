// Playwright-test voor de GitHub-back-up: node scripts/ux-github-test.mjs
// Nagebootste Tauri-laag. Controleert Verbinden-knop → eerste back-up (privé standaard), bijwerken, geheimen, bevestiging en ophalen.
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

async function naarVersies(p) {
  await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
  await p.waitForSelector("[data-testid=menu]");
  await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
  await p.waitForTimeout(500);
  await p.getByTestId("menu-versies").click();
  await p.getByTestId("versies-koppeling").waitFor();
}

try {
  for (const [naam, w, h] of FORMATEN) {
    const t = (s) => `${naam}: ${s}`;

    // ---- Niet gekoppeld → Verbinden → eerste back-up (privé) → bijwerken
    {
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: seed });
      await naarVersies(p);
      const sectie = p.getByTestId("versies-koppeling");
      await sectie.getByRole("button", { name: "Verbind met GitHub" }).click();
      const dlg = p.getByTestId("verbind-dialoog-github");
      await dlg.getByTestId("apparaat-code").waitFor();
      await p.evaluate(() => window.__connectDone("github"));
      await dlg.getByText(/Gelukt!/).waitFor();
      await dlg.getByRole("button", { name: "Klaar" }).click();
      await sectie.getByTestId("github-eerste").waitFor();
      check(t("privé staat standaard aan"), await sectie.getByRole("radio", { name: /Privé/ }).isChecked());
      check(t("naam wordt voorgesteld en is vrij"), (await sectie.getByTestId("github-naam").inputValue()) === "hovenier-joke" && /nog vrij/.test(await sectie.getByTestId("github-naam-status").innerText()));
      check(t("uitleg over wat online komt"), /Wat online komt/.test(await sectie.innerText()));
      // Openbaar vraagt uitleg + extra bevestiging
      await sectie.getByRole("radio", { name: /Openbaar/ }).click();
      check(t("openbaar: waarschuwing en knop uit"), (await sectie.getByTestId("github-openbaar-waarschuwing").isVisible()) && (await sectie.getByTestId("github-maak").isDisabled()));
      await sectie.getByRole("radio", { name: /Privé/ }).click();
      await sectie.getByTestId("github-maak").click();
      await sectie.getByTestId("github-uitkomst").waitFor();
      check(t("eerste back-up gelukt met duidelijke tekst"), /Back-up bijgewerkt: 3 nieuwe versies/.test(await sectie.getByTestId("github-uitkomst").innerText()));
      check(t("laatste back-up wordt getoond"), /Laatste back-up: zojuist/.test(await sectie.getByTestId("github-laatste").innerText()));
      check(t("alleen-vooruit-uitleg"), /nooit iets op GitHub overschreven/.test(await sectie.innerText()));
      check(t("automatisch staat standaard uit"), !(await sectie.getByRole("switch", { name: /automatisch een back-up/ }).isChecked()));
      await p.screenshot({ path: `${OUT}/github-backup-${naam}.png` });
      // Automatisch aanzetten
      await sectie.getByRole("switch", { name: /automatisch een back-up/ }).click();
      await p.waitForTimeout(200);
      check(t("automatisch staat daarna aan"), await sectie.getByRole("switch", { name: /automatisch een back-up/ }).isChecked());
      check(t("geen horizontale scroll"), await geenHScroll(p));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Gekoppeld met nieuwe versies: bijwerken; daarna geheimen en bevestiging
    {
      const link = { eigenaar: "pieter", repo: "hovenier-joke", privaat: true, url: "https://github.com/pieter/hovenier-joke", tak: "main", laatste: Math.floor(Date.now() / 1000) - 7200, laatste_aantal: 2, auto: false, ai_vraagt: true, uiteengelopen: null, probleem: null };
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { github: "werkt" }, ghLink: link, ghNieuw: 3 } });
      await naarVersies(p);
      const sectie = p.getByTestId("versies-koppeling");
      await sectie.getByTestId("github-status").waitFor();
      check(t("laatste back-up en nieuwe versies"), /2 uur geleden/.test(await sectie.getByTestId("github-laatste").innerText()) && /3 nieuwe versies/.test(await sectie.getByTestId("github-nieuw").innerText()));
      await sectie.getByTestId("github-bijwerken").click();
      await sectie.getByTestId("github-uitkomst").waitFor();
      check(t("bijwerken meldt het aantal"), /3 nieuwe versies/.test(await sectie.getByTestId("github-uitkomst").innerText()));
      await sectie.getByTestId("github-bijwerken").click();
      await p.waitForTimeout(300);
      check(t("tweede keer: al bijgewerkt"), /al bijgewerkt/.test(await sectie.getByTestId("github-uitkomst").innerText()));

      // Bevestigingsdialoog van de AI: nee, dan ja
      await p.evaluate(() => window.__stuurActie({ id: "a1", project_id: 1, soort: "github_backup", params: { repo: "pieter/hovenier-joke" }, zwaar: false }));
      const d = p.getByTestId("actie-bevestig");
      await d.waitFor();
      check(t("bevestiging noemt de repository"), /pieter\/hovenier-joke/.test(await d.innerText()));
      await d.getByTestId("actie-nee").click();
      await p.waitForTimeout(200);
      check(t("nee wordt doorgegeven en de dialoog sluit"), (await p.evaluate(() => window.__S.actieAntwoorden)).some((x) => x[0] === "a1" && x[1] === false) && (await p.getByTestId("actie-bevestig").count()) === 0);

      // Geheimen: geblokkeerd met uitleg en "Laat de AI dit herstellen" (als laatste: de nagebootste AI springt naar het voorbeeld)
      await p.evaluate(() => (window.__S.ghUitkomst = { status: "geweigerd", code: "geheimen", params: { aantal: 2, bestanden: [{ bestand: ".env", regel: null, soort: "env_bestand", historie: false }, { bestand: "src/a.ts", regel: 4, soort: "github_token", historie: false }] } }));
      await sectie.getByTestId("github-bijwerken").click();
      const lijst = sectie.getByTestId("github-vondsten");
      await lijst.waitFor();
      check(t("geheimen: bestand en soort, geen waarde"), /\.env — Een \.env-bestand/.test(await lijst.innerText()) && /src\/a\.ts \(regel 4\)/.test(await lijst.innerText()));
      await p.screenshot({ path: `${OUT}/github-geheimen-${naam}.png` });
      await sectie.getByTestId("github-herstel").click();
      check(t("'Laat de AI dit herstellen' stuurt alleen bestandsnamen"), (await p.evaluate(() => window.__S.sent.at(-1) ?? "")).includes(".env, src/a.ts (regel 4)"));
      check(t("geen horizontale scroll"), await geenHScroll(p));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Uiteengelopen: uitleg met opties, niets automatisch
    {
      const link = { eigenaar: "pieter", repo: "hovenier-joke", privaat: true, url: "https://github.com/pieter/hovenier-joke", tak: "main", laatste: Math.floor(Date.now() / 1000) - 600, laatste_aantal: 1, auto: false, ai_vraagt: true, uiteengelopen: "uiteengelopen", probleem: null };
      const { page: p, ctx } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { github: "werkt" }, ghLink: link, ghNieuw: 1 } });
      await naarVersies(p);
      const a = p.getByTestId("github-uiteengelopen");
      await a.waitFor();
      check(t("uiteengelopen: titel, opties en geen automatische actie"), /De versies zijn uiteengelopen/.test(await a.innerText()) && /Niets doen/.test(await a.innerText()) && /De AI de verschillen laten samenvoegen/.test(await a.innerText()));
      await ctx.close();
    }

    // ---- Project ophalen van GitHub (homescherm)
    {
      const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { github: "werkt" } } });
      await p.getByTestId("home-ophalen").click();
      const d = p.getByTestId("ophalen-dialoog");
      await d.waitFor();
      await d.getByText("pieter/winkel").waitFor();
      await d.getByLabel("Zoek in je projecten").fill("blog");
      check(t("zoeken filtert de lijst"), (await d.getByText("pieter/winkel").count()) === 0 && (await d.getByText("pieter/blog").count()) === 1);
      await d.getByLabel("Zoek in je projecten").fill("");
      await d.getByText("pieter/winkel").click();
      await d.getByRole("button", { name: "Map kiezen…" }).click();
      await d.getByTestId("ophalen-start").click();
      const klaar = d.getByTestId("ophalen-klaar");
      await klaar.waitFor();
      check(t("ophalen zegt wat niet herkend wordt"), /Er is geen studio\.json/.test(await klaar.getByTestId("ophalen-niet-herkend").innerText()));
      await p.screenshot({ path: `${OUT}/github-ophalen-${naam}.png` });
      check(t("geen horizontale scroll"), await geenHScroll(p));
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nGitHub-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`GitHub-test: alles goed op ${FORMATEN.length} formaten.`);

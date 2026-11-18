// Playwright-test voor de Supabase-schermen: node scripts/ux-supabase-test.mjs
// Nagebootste Tauri-laag. Controleert wizard, Gegevens, niveaus, bevestigingsdialoog, rode balk, log en controle op drie formaten.
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
const binnenBeeld = async (p, loc) => {
  const b = await loc.boundingBox();
  const vp = p.viewportSize();
  return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
};

async function naarGegevens(p) {
  await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
  await p.waitForSelector("[data-testid=menu]");
  await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
  await p.waitForTimeout(500);
  await p.getByTestId("menu-meer").click();
  await p.getByRole("menuitem", { name: "Wat je app onthoudt" }).click();
  await p.getByTestId("menu-gegevens").click();
  await p.waitForTimeout(300);
}

const req = (over = {}) => ({
  id: "v" + Math.random().toString(36).slice(2), project_id: 1, tool: "db_run_sql", actor: "ai", class: 2, level: "voorzichtig", redenen: ["niveau"],
  changes: [{ code: "tabel_toevoegen", params: { tabel: "bestellingen" } }], rijen: null, verlies: false, backup: "niet_nodig", kosten: null, waarschuwingen: [], sql: "CREATE TABLE bestellingen (id int)", uitleg: "Ik maak een tabel voor je bestellingen.", ...over,
});

try {
  for (const [naam, w, h] of FORMATEN) {
    for (const thema of ["licht", "donker"]) {
      const t = (s) => `${naam} ${thema}: ${s}`;
      const { page: p, ctx, errors } = await openApp({ w, h, theme: thema, scenario: { ...seed, connStatus: { supabase: "werkt" }, supaCheck: [{ code: "rls_uit", tabel: "bestellingen" }] } });
      await naarGegevens(p);

      if (thema === "licht") {
        // ---- Deel 2: keuze van de opslag
        const keuze = p.getByTestId("opslag-keuze");
        await keuze.waitFor();
        check(t("opslagkeuze toont twee keuzes met advies"), (await keuze.getByRole("radio").count()) === 2 && (await keuze.getByText(/Advies/).isVisible()));
        await keuze.getByRole("radio", { name: /Online, met inloggen/ }).click();
        await p.getByTestId("opslag-gekozen").waitFor();
        check(t("keuze is vastgelegd"), (await p.evaluate(() => Object.values(window.__S.opslag))).includes("online"));

        // ---- Deel 1: kies een bestaand project (de verbinding met het account staat al)
        const kies = p.getByTestId("supabase-kies");
        await kies.waitFor();
        check(t("wizard legt uit dat het wachtwoord veilig wordt bewaard"), await kies.getByText(/sterk wachtwoord/).isVisible());
        await p.screenshot({ path: `${OUT}/supabase-wizard-${naam}.png` });
        await kies.getByRole("button", { name: "Dit project gebruiken" }).click();
        await p.getByTestId("supabase-gekoppeld").waitFor();
        check(t("gekoppeld toont project en wat de AI kan doen"), /Winkel/.test(await p.getByTestId("supabase-gekoppeld").innerText()) && /Sleutels ziet de AI nooit/.test(await p.getByTestId("supabase-gekoppeld").innerText()));
        check(t("niveau staat op Voorzichtig en is zichtbaar in de balk"), (await p.getByRole("radio", { name: /Voorzichtig/ }).isChecked()) && /Voorzichtig/.test(await p.getByTestId("status-niveau").innerText()));

        // ---- Deel 8: tabellen, rijen, paginering, rij toevoegen
        const lijst = p.getByTestId("tabellen");
        await lijst.scrollIntoViewIfNeeded();
        check(t("tabellen met aantallen en beveiliging"), /klanten/.test(await lijst.innerText()) && /Niet beveiligd/.test(await lijst.innerText()) && /12 rij/.test(await lijst.innerText()));
        await lijst.getByRole("button", { name: /klanten/ }).click();
        const rijen = p.getByTestId("tabel-rijen");
        await rijen.getByText("Piet").waitFor();
        check(t("paginering: volgende aan, vorige uit"), (await rijen.getByRole("button", { name: "Volgende" }).isEnabled()) && (await rijen.getByRole("button", { name: "Vorige" }).isDisabled()));
        await rijen.getByTestId("rij-toevoegen").click();
        const rd = p.getByTestId("rij-dialoog");
        await rd.waitFor();
        check(t("rij-dialoog past in beeld"), await binnenBeeld(p, rd));
        await rd.getByRole("button", { name: "Annuleren" }).click();
        await rijen.getByRole("button", { name: /Terug naar de tabellen/ }).click();

        // ---- Controle van de database met herstelknop
        const controle = p.getByTestId("db-controle");
        await controle.scrollIntoViewIfNeeded();
        check(t("controle meldt een tabel zonder beveiliging in gewone taal"), /niet beveiligd per rij/.test(await controle.innerText()));

        // ---- Deel 4: bevestigingsdialoog in de UI (niet in de chat)
        await p.evaluate((r) => window.__stuurBevestiging(r), req());
        const dlg = p.getByTestId("bevestig-dialoog");
        await dlg.waitFor();
        check(t("bevestiging: gewone woorden"), /Er komt een tabel ‘bestellingen’ bij/.test(await dlg.innerText()) && /Ik maak een tabel voor je bestellingen/.test(await dlg.innerText()));
        check(t("bevestiging past in beeld"), await binnenBeeld(p, dlg));
        check(t("'Niet toestaan' heeft de focus"), await p.getByTestId("bevestig-nee").evaluate((e) => e === document.activeElement));
        await p.screenshot({ path: `${OUT}/supabase-bevestiging-${naam}.png` });
        await p.getByTestId("bevestig-nee").click();
        check(t("'nee' is doorgegeven"), (await p.evaluate(() => window.__S.antwoorden.at(-1)))?.[1] === false);
        await p.evaluate((r) => window.__stuurBevestiging(r), req({ class: 3, verlies: true, rijen: 120, backup: "mislukt", redenen: ["gevaarlijk", "geen_backup"], changes: [{ code: "rijen_verwijderen", params: { tabel: "klanten" } }] }));
        const gevaar = p.getByTestId("bevestig-dialoog");
        await gevaar.waitFor();
        check(t("gevaarlijk: waarschuwing over verlies, aantal rijen en ontbrekende back-up"), /verdwijnen gegevens/.test(await gevaar.innerText()) && /120 rij/.test(await gevaar.innerText()) && /GEEN back-up/.test(await gevaar.innerText()));
        check(t("gevaarlijke bevestiging past in beeld"), await binnenBeeld(p, gevaar));
        await p.getByTestId("bevestig-nee").click();
        await p.evaluate((r) => window.__stuurBevestiging(r), req({ class: 4, redenen: ["kosten"], kosten: { plan: "onbekend_plan", per_maand: 10 }, changes: [{ code: "project_maken", params: { naam: "Nieuw", regio: "Europa" } }] }));
        const kosten = p.getByTestId("bevestig-kosten");
        await kosten.waitFor();
        check(t("kosten: toont beide mogelijkheden met bedrag"), /gratis plan/.test(await kosten.innerText()) && /10 dollar/.test(await kosten.innerText()));
        await p.keyboard.press("Escape");
        check(t("Escape telt als 'nee'"), (await p.evaluate(() => window.__S.antwoorden.at(-1)))?.[1] === false);

        // ---- Niveaus: Zelfstandig, Volledige controle met typen, rode balk, terug, noodknop
        await p.getByTestId("menu-gegevens").click();
        await p.getByRole("radio", { name: /Zelfstandig/ }).scrollIntoViewIfNeeded();
        await p.getByRole("radio", { name: /Zelfstandig/ }).click();
        await p.waitForTimeout(200);
        check(t("Zelfstandig gekozen"), await p.getByRole("radio", { name: /Zelfstandig/ }).isChecked());
        await p.getByRole("radio", { name: /Volledige controle/ }).click();
        const vd = p.getByTestId("volledig-dialoog");
        await vd.waitFor();
        check(t("waarschuwing voor volledige controle past in beeld"), await binnenBeeld(p, vd));
        check(t("aanzetten kan pas na typen"), await p.getByTestId("volledig-aan").isDisabled());
        await vd.getByLabel(/Typ het woord/).fill("volledig");
        await p.getByTestId("volledig-aan").click();
        const balk = p.getByTestId("nood-balk");
        await balk.waitFor();
        check(t("rode statusbalk met tijd"), /Volledige controle staat aan/.test(await balk.innerText()) && /min/.test(await balk.innerText()));
        await p.screenshot({ path: `${OUT}/supabase-rode-balk-${naam}.png` });
        await balk.getByRole("button", { name: "Terug naar Zelfstandig" }).click();
        await p.waitForTimeout(300);
        check(t("balk weg na terug naar Zelfstandig"), (await p.getByTestId("nood-balk").count()) === 0);
        await p.getByTestId("noodknop").scrollIntoViewIfNeeded();
        await p.getByTestId("noodknop").click();
        await p.waitForTimeout(300);
        check(t("noodknop zet het niveau terug naar Voorzichtig"), (await p.getByRole("radio", { name: /Voorzichtig/ }).isChecked()) && (await p.evaluate(() => window.__S.noodknop)) >= 1);

        // ---- Actielog
        await p.getByTestId("menu-gegevens").click(); // de nagebootste AI kan het voorbeeld intussen naar voren hebben gehaald
        const log = p.getByTestId("actie-log");
        await log.scrollIntoViewIfNeeded();
        const acties = log.getByTestId("actie");
        check(t("log toont 3 acties in gewone woorden"), (await acties.count()) === 3 && /Rijen uit ‘klanten’ verdwijnen/.test(await acties.first().innerText()));
        check(t("log: geweigerde actie met reden"), /Je hebt het niet toegestaan/.test(await acties.nth(1).innerText()));
        try {
          await acties.first().getByTestId("ongedaan").click({ timeout: 5000 });
        } catch (e) {
          await p.screenshot({ path: `/tmp/supa-fail-${naam}.png` });
          console.log(`FOUT bij ongedaan (${naam}):`, (await log.innerHTML()).slice(0, 600));
          throw e;
        }
        await p.waitForTimeout(300);
        check(t("ongedaan gemaakt in het log"), /Ongedaan gemaakt/.test(await acties.first().innerText()));

        // ---- Gebruikers pas op verzoek
        await p.getByTestId("menu-gegevens").click();
        await p.getByTestId("gebruikers").getByRole("button", { name: "Gebruikers van je app" }).click();
        check(t("gebruikerslijst toont e-mail"), await p.getByText("jan@voorbeeld.nl").isVisible());

        // Als laatste: "Laat de AI dit herstellen" zet de (nagebootste) AI aan het werk, waarna het voorbeeld naar voren springt.
        await p.getByTestId("menu-gegevens").click();
        await p.getByTestId("db-controle").scrollIntoViewIfNeeded();
        await controle.getByTestId("db-herstel").click();
        check(t("'Laat de AI dit herstellen' stuurt een opdracht"), (await p.evaluate(() => window.__S.sent.at(-1) ?? "")).includes("rls_uit (bestellingen)"));
        // De opdracht zet de (nagebootste) AI aan het werk en het voorbeeld springt naar voren: ga terug naar Gegevens.
        await p.getByTestId("menu-gegevens").click();
        await p.getByTestId("supabase-gekoppeld").waitFor();
        await p.getByTestId("supabase-gekoppeld").scrollIntoViewIfNeeded();
        // ---- Ontkoppelen: Supabase blijft ongemoeid
        await p.getByTestId("supabase-gekoppeld").getByRole("button", { name: "Project ontkoppelen" }).click();
        check(t("ontkoppelen legt uit dat Supabase ongemoeid blijft"), /Er verandert niets bij Supabase/.test(await p.getByRole("alertdialog").innerText()));
        await p.getByRole("alertdialog").getByRole("button", { name: "Annuleren" }).click();
      }
      check(t("geen horizontale scroll"), await geenHScroll(p));
      await p.screenshot({ path: `${OUT}/supabase-gegevens-${naam}-${thema === "licht" ? "licht" : "donker"}.png` });
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Nieuw project maken (gratis plan) met wachtmelding en uitleg
    const { page: q, ctx: c2 } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { supabase: "werkt" } } });
    await naarGegevens(q);
    await q.getByTestId("opslag-keuze").getByRole("radio", { name: /Online, met inloggen/ }).click();
    const kies2 = q.getByTestId("supabase-kies");
    await kies2.waitFor();
    await kies2.getByLabel("Naam van het nieuwe project").fill("Mijn webwinkel");
    check(`${naam}: uitleg over wachttijd en regio`, /twee minuten/.test(await kies2.innerText()) && /Europa/.test(await kies2.innerText()));
    await kies2.getByTestId("supa-maak").click();
    await q.getByTestId("supa-wachten").waitFor();
    check(`${naam}: wachtmelding na het maken`, /twee minuten/.test(await q.getByTestId("supa-wachten").innerText()));
    await c2.close();

    // ---- Zonder verbinding: alleen de Verbind-knop; niets over projecten
    const { page: z, ctx: c3 } = await openApp({ w, h, theme: "licht", scenario: seed });
    await naarGegevens(z);
    check(`${naam}: zonder verbinding geen projectkeuze, wel de Verbind-knop`, (await z.getByTestId("supabase-kies").count()) === 0 && (await z.getByRole("button", { name: "Verbind met Supabase" }).count()) === 1);
    await c3.close();
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nSupabase-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`Supabase-test: alles goed op ${FORMATEN.length} formaten.`);

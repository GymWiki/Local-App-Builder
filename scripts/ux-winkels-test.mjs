// Playwright-test voor In de appwinkel: node scripts/ux-winkels-test.mjs
// Nagebootste Tauri-laag. Controleert Wat heb je nodig, gegevens en app-naam, klaar-check, formulierhulp, controle en Winkelpakket → Teksten.
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

try {
  for (const [naam, w, h] of FORMATEN) {
    const t = (s) => `${naam}: ${s}`;
    const { page: p, ctx, errors } = await openApp({ w, h, theme: "licht", scenario: seed });
    await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
    await p.waitForSelector("[data-testid=menu]");
    await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
    await p.waitForTimeout(500);
    await p.getByTestId("menu-appwinkel").click();
    await p.getByTestId("winkels-nodig").waitFor();

    // Wat heb je nodig: kosten per winkel, eerlijk over wat nog niet gecontroleerd is, en wie wat doet
    check(t("kosten Google staan er met 'controleer zelf'"), /Eenmalig/.test(await p.getByTestId("kosten-play").innerText()) && /niet uit de officiële tekst/.test(await p.getByTestId("kosten-play").innerText()));
    check(t("kosten Apple staan er zonder voorbehoud"), /99 dollar/.test(await p.getByTestId("kosten-appstore").innerText()) && !/niet uit de officiële tekst/.test(await p.getByTestId("kosten-appstore").innerText()));
    check(t("bouwen is eerlijk 'nog niet gebouwd'"), /Nog niet gebouwd/.test(await p.locator("[data-winkel=play] [data-stap=bouwen]").innerText()));
    await p.screenshot({ path: `${OUT}/winkels-nodig-${naam}.png` });

    // Gegevens: ongeldige app-naam geeft een duidelijke fout; geldige wordt bewaard
    const g = p.getByTestId("winkels-gegevens");
    await g.scrollIntoViewIfNeeded();
    await g.getByTestId("wg-android").fill("nl.1winkel");
    await g.getByTestId("wg-bewaar").click();
    await p.getByText("Elk deel moet met een letter beginnen.").waitFor();
    await g.getByTestId("wg-domein").fill("hovenierjoke.nl");
    await g.getByTestId("wg-voorstel").click();
    await g.getByTestId("wg-voorstel-tekst").waitFor();
    await g.getByRole("button", { name: "Gebruik dit" }).click();
    await g.getByTestId("wg-privacy").fill("https://hovenierjoke.nl/privacy");
    await g.getByTestId("wg-email").fill("info@hovenierjoke.nl");
    await g.getByTestId("wg-bewaar").click();
    await p.waitForTimeout(400);
    check(t("klaar-check: unieke app-naam en privacy zijn klaar"), (await p.locator("[data-testid=klaar-play] [data-punt=app_id]").getAttribute("data-status")) === "klaar" && (await p.locator("[data-testid=klaar-play] [data-punt=privacy]").getAttribute("data-status")) === "klaar");
    // Versie ophogen
    await g.getByTestId("versie-build").click();
    await p.waitForTimeout(300);
    check(t("buildnummer is opgehoogd"), /1\.0\.0\+2/.test(await g.getByTestId("winkels-versie-nu").innerText()));

    // Klaar-check: wat je zelf bij de winkel doet kun je afvinken
    const kp = p.getByTestId("klaar-play");
    await kp.scrollIntoViewIfNeeded();
    const tel0 = await p.getByTestId("klaar-telling-play").innerText();
    await kp.locator("[data-punt=data_safety]").getByRole("checkbox").click();
    await p.waitForTimeout(400);
    check(t("afvinken verhoogt de telling"), (await p.getByTestId("klaar-telling-play").innerText()) !== tel0);
    check(t("handmatige punten staan er met hun uitleg"), /Gegevensveiligheid/.test(await kp.innerText()));

    // Formulierhulp met verantwoordelijkheid
    const iv = p.getByTestId("winkels-invulhulp");
    await iv.scrollIntoViewIfNeeded();
    check(t("invulhulp: geen juridisch advies + antwoordkaarten"), /geen juridisch advies/.test(await iv.getByTestId("invul-verantwoordelijk").innerText()) && (await iv.locator("[data-kaart]").count()) === 3);
    check(t("invulhulp: leeftijd blijft 'controleer dit zelf'"), /Controleer dit zelf/.test(await iv.locator("[data-kaart=leeftijd]").innerText()));
    await p.screenshot({ path: `${OUT}/winkels-overzicht-${naam}.png` });

    // Winkelpakket → Teksten: limiet, teller, goedkeuren, vergrendelen
    await p.getByRole("tab", { name: "Winkelpakket" }).click();
    const tk = p.getByTestId("winkelpakket-teksten");
    await tk.waitFor();
    const sub = tk.getByTestId("tekst-subtitel");
    await sub.fill("x".repeat(31));
    check(t("teller toont ! boven de limiet en goedkeuren is uit"), (await tk.getByTestId("teller-subtitel").getAttribute("data-goed")) === "nee" && (await tk.getByTestId("goedkeuren-subtitel").isDisabled()));
    await sub.fill("Tuinonderhoud 👍🏽");
    check(t("teller telt emoji als één teken"), /15 van 30 tekens/.test(await tk.getByTestId("teller-subtitel").innerText()), await tk.getByTestId("teller-subtitel").innerText());
    await tk.getByTestId("goedkeuren-subtitel").click();
    await tk.getByTestId("vergrendeld-subtitel").waitFor();
    check(t("goedgekeurde tekst is vergrendeld"), await tk.getByTestId("tekst-subtitel").isDisabled());
    await tk.getByTestId("ontgrendel-subtitel").click();
    await tk.getByTestId("opslaan-subtitel").waitFor();
    await p.screenshot({ path: `${OUT}/winkels-teksten-${naam}.png` });
    check(t("geen horizontale scroll"), await geenHScroll(p));
    // Als laatste: 'Laat de AI schrijven' zet de (nagebootste) AI aan het werk en het voorbeeld springt naar voren.
    await tk.getByTestId("ai-subtitel").click();
    check(t("AI-voorstel noemt de limiet en het hulpmiddel"), /30 tekens/.test(await p.evaluate(() => window.__S.sent.at(-1) ?? "")) && /winkel_schrijf_teksten/.test(await p.evaluate(() => window.__S.sent.at(-1) ?? "")));
    check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
    await ctx.close();
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nWinkels-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`Winkels-test: alles goed op ${FORMATEN.length} formaten.`);

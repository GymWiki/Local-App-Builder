// Playwright-test voor de Verbinden-knoppen: node scripts/ux-koppel-test.mjs
// Nagebootste Tauri-laag; GitHub = apparaatcode, Vercel en Supabase = sleutel plakken. Screenshots in docs/ui/.
import { mkdirSync } from "node:fs";
import { openApp, stop } from "./ux-sim.mjs";

const FORMATEN = [
  ["1280x720", 1280, 720],
  ["1366x768", 1366, 768],
  ["1920x1080", 1920, 1080],
];
const OUT = "docs/ui";
mkdirSync(OUT, { recursive: true });
const fouten = [];
const check = (naam, ok, extra = "") => {
  if (!ok) fouten.push(`${naam}${extra ? ` (${extra})` : ""}`);
};
const geenHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const seed = { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] };

async function openProject(p) {
  await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
  await p.waitForSelector("[data-testid=menu]");
  await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
  await p.waitForTimeout(500);
}
const binnenBeeld = async (p, loc) => {
  const b = await loc.boundingBox();
  const vp = p.viewportSize();
  return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
};

try {
  for (const [naam, w, h] of FORMATEN) {
    for (const thema of ["licht", "donker"]) {
      const t = (s) => `${naam} ${thema}: ${s}`;
      const { page: p, ctx, errors } = await openApp({ w, h, theme: thema, scenario: seed });
      await openProject(p);

      // ---- Instellingen > Mijn programma > Koppelingen: alle diensten, niet gekoppeld
      await p.getByTestId("menu-instellingen").click();
      await p.getByRole("tab", { name: "Mijn programma" }).click();
      const ov = p.getByTestId("koppelingen-overzicht");
      await ov.scrollIntoViewIfNeeded();
      check(t("overzicht toont drie diensten"), (await ov.locator("li[data-dienst]").count()) === 3);
      check(t("overzicht: alles 'Niet gekoppeld'"), (await ov.getByText("Niet gekoppeld").count()) === 3);
      check(t("privacy-uitleg zichtbaar"), await p.getByText(/De toegang blijft op dit apparaat/).first().isVisible());

      if (thema === "licht") {
        // ---- Vercel: sleutel plakken, eerst fout, dan gelukt
        await ov.getByRole("button", { name: "Verbind met Vercel" }).click();
        const dlg = p.getByTestId("verbind-dialoog-vercel");
        await dlg.waitFor();
        check(t("dialoog past in beeld"), await binnenBeeld(p, dlg));
        check(t("dialoog legt uit dat het wachtwoord bij de dienst blijft"), await dlg.getByText(/Je wachtwoord blijft bij Vercel/).isVisible());
        const veld = dlg.getByLabel("Toegangssleutel");
        await veld.scrollIntoViewIfNeeded();
        check(t("sleutelveld is verborgen"), (await veld.getAttribute("type")) === "password");
        await dlg.getByRole("button", { name: "Toon" }).click();
        check(t("sleutel tonen werkt"), (await veld.getAttribute("type")) === "text");
        await veld.fill("fout-token");
        await dlg.getByRole("button", { name: "Verbinden" }).click();
        await dlg.getByTestId("verbind-fout").waitFor();
        check(t("foute sleutel geeft gewone melding"), /Deze sleutel werkt niet/.test(await dlg.getByTestId("verbind-fout").innerText()));
        await veld.fill("goed-token");
        await dlg.getByRole("button", { name: "Verbinden" }).click();
        await dlg.getByText(/Gelukt! Je bent verbonden met Vercel/).waitFor();
        check(t("gelukt toont accountnaam"), await dlg.getByText(/Ingelogd als joke/).first().isVisible());
        check(t("de sleutel staat nergens in de pagina"), !(await p.content()).includes("goed-token"));
        await p.screenshot({ path: `${OUT}/koppelen-gelukt-${naam}.png` });
        await dlg.getByRole("button", { name: "Klaar" }).click();
        check(t("overzicht: Vercel werkt"), /Werkt/.test(await p.getByTestId("koppel-status-vercel").innerText()));

        // ---- Ontkoppelen met uitleg en link
        await ov.getByRole("button", { name: "Opties voor Vercel" }).click();
        await p.getByRole("menuitem", { name: "Ontkoppelen" }).click();
        const vraag = p.getByRole("alertdialog");
        check(t("ontkoppelen legt uit dat de sleutel van de computer verdwijnt"), /verwijdert je sleutel van deze computer/.test(await vraag.innerText()));
        await vraag.getByTestId("ontkoppel-bevestig").click();
        await p.getByText(/Vercel is ontkoppeld/).waitFor();
        await p.getByRole("button", { name: /Open de pagina van Vercel om toegang in te trekken/ }).click();
        check(t("link naar de beheerpagina is geopend"), (await p.evaluate(() => window.__S.opened)).some((u) => u.includes("/settings/applications")));
        await p.getByRole("button", { name: "Klaar" }).click();
        check(t("na ontkoppelen weer 'Niet gekoppeld'"), /Niet gekoppeld/.test(await p.getByTestId("koppel-status-vercel").innerText()));

        // ---- GitHub op de plek Eerdere versies: apparaatcode
        await p.getByTestId("menu-versies").click();
        const sectie = p.getByTestId("versies-koppeling");
        await sectie.waitFor();
        await sectie.getByRole("button", { name: "Verbind met GitHub" }).click();
        const gh = p.getByTestId("verbind-dialoog-github");
        const code = gh.getByTestId("apparaat-code");
        await code.waitFor();
        check(t("apparaatcode staat groot in beeld"), (await code.innerText()).includes("ABCD-1234") && (await binnenBeeld(p, code)));
        check(t("apparaatcode: Open de pagina en Kopieer de code"), (await code.getByRole("button", { name: "Open de pagina" }).isVisible()) && (await code.getByRole("button", { name: "Kopieer de code" }).isVisible()));
        await code.getByRole("button", { name: "Open de pagina" }).click();
        check(t("pagina van de dienst is geopend"), (await p.evaluate(() => window.__S.opened)).includes("https://github.com/login/device"));
        await p.screenshot({ path: `${OUT}/koppelen-apparaatcode-${naam}.png` });
        await p.evaluate(() => window.__connectDone("github"));
        await gh.getByText(/Gelukt!/).waitFor();
        await gh.getByRole("button", { name: "Klaar" }).click();
        check(t("na verbinden toont de plek de accountnaam met ✓"), /GitHub: pieter/.test(await sectie.getByRole("button", { name: "Opties voor GitHub" }).innerText()));

        // ---- Geweigerd: duidelijke fout met oplossing
        await ov.scrollIntoViewIfNeeded().catch(() => undefined);
        await p.getByTestId("menu-instellingen").click();
        await p.getByRole("tab", { name: "Mijn programma" }).click();
        await p.evaluate(() => window.__connectFail("github", "geweigerd"));
        await p.waitForTimeout(500);
        check(t("overzicht toont de fout na een geweigerde poging"), await p.getByText(/Je hebt geen toestemming gegeven/).first().isVisible());

        // ---- Gegevens: Supabase-knop (via Meer onderdelen)
        await p.getByTestId("menu-meer").click();
        await p.getByRole("menuitem", { name: "Wat je app onthoudt" }).click();
        await p.getByTestId("menu-gegevens").click();
        const gg = p.getByTestId("gegevens-koppeling");
        await gg.waitFor();
        check(t("Gegevens heeft de Supabase-knop"), await gg.getByRole("button", { name: "Verbind met Supabase" }).isVisible());
      }
      check(t("geen horizontale scroll"), await geenHScroll(p));
      await p.screenshot({ path: `${OUT}/koppelen-menu-${naam}-${thema === "licht" ? "licht" : "donker"}.png` });
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Statusbolletje: verlopen Vercel-koppeling vraagt actie bij Online zetten
    const { page: q, ctx: c2 } = await openApp({ w, h, theme: "licht", scenario: { ...seed, connStatus: { vercel: "verlopen", github: "werkt" } } });
    await openProject(q);
    check(`${naam}: Online zetten toont '!' bij een verlopen koppeling`, (await q.getByTestId("menu-onlinezetten").getByTestId("punt-actie").count()) === 1);
    check(`${naam}: Eerdere versies toont geen '!' bij een werkende GitHub`, (await q.getByTestId("menu-versies").getByTestId("punt-actie").count()) === 0);
    await c2.close();
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nKoppel-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`Koppel-test: alles goed op ${FORMATEN.length} formaten.`);

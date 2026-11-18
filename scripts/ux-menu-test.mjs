// Playwright-test voor het nieuwe menu en de instellingen: node scripts/ux-menu-test.mjs
// Draait op 1280x720, 1366x768 en 1920x1080 en bewaart screenshots (licht en donker) in docs/ui/.
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

// [testid, titel van het paneel]
const HOOFD = [
  ["start", "Start"],
  ["schermen", "Schermen"],
  ["uiterlijk", "Uiterlijk"],
  ["bestanden", "Foto’s en bestanden"],
  ["onlinezetten", "Online zetten"],
  ["appwinkel", "In de appwinkel"],
  ["versies", "Eerdere versies"],
  ["instellingen", "Instellingen"],
];
const GEVORDERD = [
  ["terminal", "Terminal"],
  ["logs", "Logs"],
  ["technischestatus", "Technische status"],
  ["code", "Code en bestanden"],
];

async function openProject(p) {
  await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
  await p.waitForSelector("[data-testid=menu]");
  await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
  await p.waitForTimeout(500);
}
const paneelZichtbaar = (p, naam) => p.locator(".flexlayout__tab_button", { hasText: naam }).first().isVisible().catch(() => false);

try {
  for (const [naam, w, h] of FORMATEN) {
    const tag = (s) => `${naam}: ${s}`;
    for (const thema of ["licht", "donker"]) {
      const { page: p, ctx, errors } = await openApp({ w, h, theme: thema, scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] } });
      await openProject(p);
      const t = (s) => `${tag(s)} (${thema})`;

      // ---- menu: opbouw
      check(t("menu zichtbaar met projectnaam en 'Alle projecten'"), (await p.getByTestId("menu").isVisible()) && (await p.getByTestId("menu-terug").isVisible()) && (await p.getByTestId("menu").getByText("Hovenier Joke").first().isVisible()));
      const zichtbaar = await p.locator("[data-testid=menu] [data-testid^=menu-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice(5)).filter((id) => !["terug", "klap", "hulp", "meer", "gevorderd"].includes(id)));
      check(t("hoogstens 8 onderdelen zichtbaar in de standaardstand"), zichtbaar.length <= 8 && zichtbaar.length > 0, zichtbaar.join(","));
      check(t("de acht hoofdonderdelen staan erin"), HOOFD.every(([id]) => zichtbaar.includes(id)), zichtbaar.join(","));
      check(t("geen Gegevens of Voor-gevorderden-items vooraf"), !zichtbaar.includes("gegevens") && !zichtbaar.includes("terminal"));
      check(t("geen horizontale scroll"), await geenHScroll(p));
      if (thema === "licht") await p.screenshot({ path: `${OUT}/na-menu-${naam}-licht.png` });
      else await p.screenshot({ path: `${OUT}/na-menu-${naam}-donker.png` });

      if (thema === "licht") {
        // ---- alle menu-items openen hun paneel
        for (const [id, titel] of HOOFD) {
          await p.getByTestId(`menu-${id}`).click();
          await p.waitForTimeout(250);
          check(t(`menu '${titel}' opent het paneel`), await paneelZichtbaar(p, titel));
        }
        await p.getByTestId("menu-hulp").click();
        await p.waitForTimeout(250);
        check(t("menu 'Hulp' opent het paneel"), await paneelZichtbaar(p, "Hulp"));

        // ---- Start: voortgang in vier stappen en één grote knop
        await p.getByTestId("menu-start").click();
        await p.waitForTimeout(250);
        const stappen = await p.getByTestId("stappen").locator("li").count();
        check(t("Start toont vier stappen"), stappen === 4, String(stappen));
        check(t("Start heeft één grote 'Volgende stap'-knop"), (await p.getByTestId("volgende-stap").count()) === 1);
        const eerste = await p.getByTestId("stappen").locator("li").first().innerText();
        check(t("stap 1 is nog niet klaar"), !/klaar/.test(eerste.split("\n").slice(1).join(" ")) || /nog te doen/.test(eerste), eerste.slice(0, 60));
        await p.getByTestId("volgende-stap").click();
        await p.waitForTimeout(300);
        check(t("'Volgende stap' brengt je bij het gesprek (typen kan)"), await p.getByRole("textbox", { name: /Wat wil je maken of veranderen/ }).isVisible().catch(() => false));

        // ---- Meer onderdelen: Gegevens activeren
        await p.getByTestId("menu-meer").click();
        const gegevensItem = p.getByRole("menuitem", { name: "Wat je app onthoudt" });
        check(t("'Meer onderdelen' toont Wat je app onthoudt"), await gegevensItem.isVisible().catch(() => false));
        await gegevensItem.click();
        await p.waitForTimeout(300);
        check(t("na activeren staat Gegevens in het menu"), (await p.getByTestId("menu-gegevens").count()) === 1);
        check(t("Gegevens opent zijn paneel"), (await p.getByTestId("menu-gegevens").click(), await p.waitForTimeout(250), await paneelZichtbaar(p, "Wat je app onthoudt")));

        // ---- Voor gevorderden: standaard dicht, daarna alle vier bereikbaar
        check(t("'Voor gevorderden' is standaard dicht"), (await p.getByTestId("menu-terminal").count()) === 0);
        await p.getByTestId("menu-gevorderd").click();
        for (const [id, titel] of GEVORDERD) {
          await p.getByTestId(`menu-${id}`).scrollIntoViewIfNeeded();
          await p.getByTestId(`menu-${id}`).click();
          await p.waitForTimeout(250);
          check(t(`gevorderd '${titel}' opent het paneel`), await paneelZichtbaar(p, titel));
        }

        // ---- Instellingen: vier groepen met bereik en herstellen
        await p.getByTestId("menu-instellingen").click();
        await p.waitForSelector("[data-testid=instellingen]");
        for (const [groep, test] of [
          ["Mijn project", "inst-naam-bereik"],
          ["Mijn AI", "inst-toestemming-bereik"],
          ["Mijn programma", "inst-thema-bereik"],
          ["Voor gevorderden", null],
        ]) {
          await p.getByRole("tab", { name: groep }).click();
          await p.waitForTimeout(200);
          if (test) check(t(`groep '${groep}' toont instellingen met bereik`), await p.getByTestId(test).isVisible().catch(() => false));
          else check(t("groep 'Voor gevorderden' toont de waarschuwing"), await p.getByText(/Beginners hebben dit niet nodig/).first().isVisible().catch(() => false));
        }
        await p.getByRole("tab", { name: "Mijn AI" }).click();
        await p.getByRole("radio", { name: /Werk zelfstandig/ }).click();
        check(t("'Werk zelfstandig' toont een waarschuwing"), await p.getByTestId("waarschuwing-zelfstandig").isVisible().catch(() => false));
        await p.getByTestId("inst-toestemming-herstel").click();
        check(t("'Standaard herstellen' zet 'Vraag bij belangrijke dingen' terug"), await p.getByRole("radio", { name: /Vraag bij belangrijke dingen/ }).isChecked());
        await p.screenshot({ path: `${OUT}/na-instellingen-${naam}-licht.png` });

        // ---- menu inklappen: tooltips en namen voor schermlezers
        await p.getByTestId("menu-klap").click();
        await p.waitForTimeout(300);
        check(t("menu klapt in tot iconen"), (await p.getByTestId("menu").getAttribute("data-ingeklapt")) === "ja");
        check(t("ingeklapte knoppen hebben een naam (schermlezer)"), (await p.locator("[data-testid=menu] button").evaluateAll((bs) => bs.filter((b) => !(b.getAttribute("aria-label") || b.textContent.trim())).length)) === 0);
        await p.getByTestId("menu-start").hover();
        await p.waitForTimeout(700);
        check(t("tooltip bij Start toont de sneltoets"), await p.getByRole("tooltip").filter({ hasText: "Ctrl + Shift + S" }).first().isVisible().catch(() => false));
        check(t("geen horizontale scroll (ingeklapt)"), await geenHScroll(p));
        await p.screenshot({ path: `${OUT}/na-menu-ingeklapt-${naam}-licht.png` });
        await p.getByTestId("menu-klap").click();

        // ---- toetsenbord: Tab bereikt de menu-items en focus is zichtbaar
        await p.getByTestId("menu-terug").focus();
        await p.keyboard.press("Tab");
        await p.keyboard.press("Tab");
        const focusOnderMenu = await p.evaluate(() => !!document.activeElement?.closest("[data-testid=menu]"));
        check(t("Tab blijft logisch binnen het menu"), focusOnderMenu);
        const ring = await p.evaluate(() => {
          const s = getComputedStyle(document.activeElement);
          return s.outlineStyle !== "none" || s.boxShadow !== "none";
        });
        check(t("de focus is zichtbaar"), ring);

        // ---- lege staat: Eerdere versies
        await p.getByTestId("menu-versies").click();
        await p.waitForTimeout(300);
        check(t("Eerdere versies heeft een lege staat met een actie"), (await p.getByTestId("versies-leeg").isVisible().catch(() => false)) && (await p.getByRole("button", { name: "Naar het gesprek" }).isVisible().catch(() => false)));
      }
      check(t("geen scriptfouten"), errors.length === 0, errors.join(" | ").slice(0, 200));
      await ctx.close();
    }

    // ---- Homescherm: instellingen voor alle projecten
    const { page: q, ctx: c2 } = await openApp({ w, h, theme: "licht", scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] } });
    await q.getByRole("button", { name: "Instellingen" }).first().click();
    await q.waitForSelector("[data-testid=instellingen]");
    const tabs = await q.getByRole("tab").allInnerTexts();
    check(tag("homescherm: instellingen in drie groepen zonder 'Mijn project'"), tabs.join("|") === "Mijn AI|Mijn programma|Voor gevorderden", tabs.join("|"));
    await q.screenshot({ path: `${OUT}/na-instellingen-start-${naam}-licht.png` });
    await c2.close();
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nMenu-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`Menu-test: alles goed op ${FORMATEN.length} formaten (licht en donker).`);

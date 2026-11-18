// UX-regressietest: node scripts/ux-test.mjs [--update]
// Draait op zeven venstergroottes (ook 125% en 150% schaal) de belangrijkste flows van homescherm en werkruimte
// en vergelijkt screenshots met docs/ux/basis/. Met --update worden de basisscreenshots vernieuwd.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openApp, stop } from "./ux-sim.mjs";

const update = process.argv.includes("--update");
const FORMATEN = [
  ["900x600", 900, 600, 1],
  ["1280x720", 1280, 720, 1],
  ["1366x768", 1366, 768, 1],
  ["1536x864-125", 1920, 1080, 1.25],
  ["1280x720-150", 1920, 1080, 1.5],
  ["1920x1080", 1920, 1080, 1],
  ["2560x1440", 2560, 1440, 1],
];
const BASIS = "docs/ux/basis";
mkdirSync(BASIS, { recursive: true });
const fouten = [];
const check = (naam, ok, extra = "") => {
  if (!ok) fouten.push(`${naam}${extra ? ` (${extra})` : ""}`);
};
const geenHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

try {
  for (const [naam, w, h, scale] of FORMATEN) {
    const vw = Math.round(w / scale);
    const vh = Math.round(h / scale);
    const tag = (s) => `${naam}: ${s}`;

    // ---- Homescherm: lege staat en nieuw project
    const { page: p, ctx } = await openApp({ w, h, scale, theme: "licht" });
    check(tag("lege staat: grote knop zichtbaar"), await p.getByRole("button", { name: "Maak je eerste project" }).isVisible());
    check(tag("lege staat: geen horizontale scroll"), await geenHScroll(p));
    await p.getByRole("button", { name: "Maak je eerste project" }).click();
    await p.getByLabel(/Projectnaam/).fill("Hovenier Joke");
    await p.getByRole("button", { name: /Map kiezen/ }).click();
    const maak = p.getByRole("button", { name: "Project aanmaken" });
    await maak.scrollIntoViewIfNeeded();
    const mb = await maak.boundingBox();
    check(tag("'Project aanmaken' binnen beeld"), !!mb && mb.y >= 0 && mb.y + mb.height <= vh + 1, JSON.stringify(mb));
    await maak.click();
    await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
    await p.waitForTimeout(500);

    // ---- Werkruimte: panelen, iconenbalk, status
    check(tag("iconenbalk met 10 onderdelen"), (await p.locator("[data-testid=rail] button").count()) === 10);
    check(tag("status van voorbeeld en AI-koppeling zichtbaar"), (await p.getByTestId("status-preview").isVisible()) && (await p.getByTestId("status-mcp").isVisible()));
    check(tag("geen horizontale scroll (werkruimte)"), await geenHScroll(p));
    const breedtes = await p.evaluate(() => [...document.querySelectorAll(".flexlayout__tabset")].map((e) => Math.round(e.getBoundingClientRect().width)));
    check(tag("geen paneel smaller dan 200 px"), breedtes.every((b) => b >= 200), breedtes.join(","));

    // ---- Opdracht typen en versturen in de chat
    const veld = p.getByRole("textbox", { name: /Wat wil je maken of veranderen/ });
    const vb = await veld.boundingBox();
    check(tag("invoerveld ≥ 240px breed"), !!vb && vb.width >= 240, JSON.stringify(vb));
    await veld.fill("Een heel lang woord: " + "Zeeuwsevolkstoneelgezelschapsrepetitieruimte".repeat(3) + "\nregel twee\nregel drie\nregel vier\nregel vijf\nregel zes");
    const vb2 = await veld.boundingBox();
    check(tag("invoerveld groeit niet boven 31% van de hoogte"), !!vb2 && vb2.height <= Math.max(vh * 0.31, 150), JSON.stringify(vb2));
    const verstuur = p.getByRole("button", { name: "Versturen" });
    await verstuur.scrollIntoViewIfNeeded();
    const sb = await verstuur.boundingBox();
    check(tag("'Versturen' binnen beeld"), !!sb && sb.x >= 0 && sb.x + sb.width <= vw + 1 && sb.y + sb.height <= vh + 1, JSON.stringify(sb));
    await veld.fill("maak een website voor mijn bedrijf");
    await veld.press("Enter");
    await p.waitForTimeout(7500);
    check(tag("AI-antwoord zichtbaar"), await p.getByText(/Wil je dat ik iets verander/).first().isVisible().catch(() => false));

    // ---- Eigenschappen: een onderdeel kiezen in de preview, ouder/kind, en een wens naar de chat
    await p.getByRole("button", { name: "Kies een onderdeel" }).first().click();
    await p.waitForTimeout(700);
    await p.frameLocator("iframe").locator("button.knop").click();
    await p.waitForTimeout(700);
    const sel = p.getByTestId("eigenschappen-selectie");
    check(tag("eigenschappen tonen de gekozen knop"), await sel.isVisible().catch(() => false));
    const selTekst = (await sel.innerText().catch(() => "")) || "";
    check(tag("eigenschappen: soort, afmeting, kit en token"), /Knop/.test(selTekst) && /pixels/.test(selTekst) && /button/.test(selTekst) && /primary/.test(selTekst), selTekst.slice(0, 80));
    await p.getByRole("button", { name: "Kies het onderdeel erboven" }).click();
    await p.waitForTimeout(500);
    check(tag("eigenschappen: ouder kiezen werkt"), /main/.test(await p.getByTestId("breadcrumb").innerText()));
    await p.getByLabel("Beschrijf wat je anders wilt").fill("maak dit groter");
    await p.getByRole("button", { name: "Naar de AI sturen" }).click();
    await p.waitForTimeout(600);
    check(tag("eigenschappen: wens is naar de chat gestuurd"), (await p.evaluate(() => window.__S.sent.at(-1) ?? "")).includes("maak dit groter"));
    await p.getByRole("button", { name: "Keuze wissen" }).click();
    await p.waitForTimeout(300);

    // ---- Slepen van een scheidingsgreep: preview laadt niet opnieuw, indeling wordt bewaard en teruggezet
    let navs = 0;
    p.on("framenavigated", (f) => {
      if (f !== p.mainFrame()) navs++;
    });
    const compact = (await p.locator("[data-testid=workspace] .studio-layout").getAttribute("data-compact")) === "ja";
    const sep = compact ? p.locator("[role=separator]").first() : p.locator("[role=separator]").nth(1);
    const sb0 = await sep.boundingBox();
    await p.mouse.move(sb0.x + sb0.width / 2, sb0.y + sb0.height / 2);
    await p.mouse.down();
    await p.mouse.move(sb0.x - 120, sb0.y + 30, { steps: 10 });
    await p.mouse.up();
    check(tag("preview herlaadt niet tijdens slepen"), navs === 0, `${navs} navigaties`);
    await p.waitForTimeout(700);
    const bewaard = await p.evaluate(() => window.__S.layouts[1]?.json ?? null);
    if (!compact) check(tag("indeling is opgeslagen"), !!bewaard && bewaard.includes('"weight"'));
    const voor = await p.evaluate(() => [...document.querySelectorAll(".flexlayout__tabset")].map((e) => Math.round(e.getBoundingClientRect().width)).join(","));
    await p.getByRole("button", { name: "Alle projecten" }).click();
    await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
    await p.waitForSelector("[data-testid=workspace] .flexlayout__tabset");
    await p.waitForTimeout(500);
    const na = await p.evaluate(() => [...document.querySelectorAll(".flexlayout__tabset")].map((e) => Math.round(e.getBoundingClientRect().width)).join(","));
    if (!compact) check(tag("zelfde indeling na terugkeren"), voor === na, `${voor} ≠ ${na}`);

    // ---- Toetsenbord: scheidingsgreep met pijltjestoetsen
    const greep = p.locator("[role=separator]").first();
    await greep.focus();
    const breedtes0 = async () => p.evaluate(() => [...document.querySelectorAll(".flexlayout__tabset")].map((e) => Math.round(e.getBoundingClientRect().width)).join(","));
    const v0 = await breedtes0();
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(500);
    const v1 = await breedtes0();
    check(tag("scheidingsgreep reageert op pijltjestoets"), v0 !== v1, `${v0} → ${v1}`);
    check(tag("scheidingsgreep heeft een naam voor schermlezers"), !!(await greep.getAttribute("aria-label")));

    // ---- Verplaatsen: slepen (docken als tabblad) en het menu; de preview laadt daarbij niet opnieuw
    if (!compact) {
      const tabsLijst = () => p.evaluate(() => [...document.querySelectorAll(".flexlayout__tabset")].map((ts) => [...ts.querySelectorAll(".flexlayout__tab_button")].map((b) => b.textContent.trim()).join("+")).join("|"));
      const navs0 = navs;
      const gesprek = await p.locator(".flexlayout__tab_button", { hasText: "Gesprek" }).first().boundingBox();
      const voorbeeld = await p.locator(".flexlayout__tabset", { has: p.locator(".flexlayout__tab_button", { hasText: "Voorbeeld" }) }).first().boundingBox();
      await p.mouse.move(gesprek.x + 10, gesprek.y + 10);
      await p.mouse.down();
      await p.mouse.move(gesprek.x - 30, gesprek.y - 30, { steps: 6 });
      await p.mouse.move(voorbeeld.x + voorbeeld.width / 2, voorbeeld.y + voorbeeld.height / 2, { steps: 15 });
      await p.mouse.up();
      await p.waitForTimeout(500);
      check(tag("slepen: gesprek wordt tabblad bij het voorbeeld"), (await tabsLijst()).includes("Voorbeeld+Gesprek"), await tabsLijst());
      check(tag("slepen: preview laadt niet opnieuw"), navs === navs0, `${navs - navs0} navigaties`);
      await p.getByTestId("verplaats-chat").click();
      await p.getByRole("menuitem", { name: "Rechts in de werkruimte", exact: true }).click();
      await p.waitForTimeout(500);
      check(tag("menu: gesprek staat weer in een eigen groep"), !(await tabsLijst()).includes("Voorbeeld+Gesprek"), await tabsLijst());
      await p.getByTestId("verplaats-eigenschappen").click();
      await p.getByRole("menuitem", { name: "Los laten zweven", exact: true }).click();
      await p.waitForTimeout(600);
      check(tag("menu: zwevend paneel is zichtbaar"), await p.locator(".flexlayout__floating_window, .flexlayout__layout_float, [class*=float_window]").first().isVisible().catch(() => false));
      check(tag("zweven: preview laadt niet opnieuw"), navs === navs0, `${navs - navs0} navigaties`);
    }

    // ---- Vaste indelingen en herstel
    const menu = async (item) => {
      await p.getByRole("button", { name: "Indeling van de werkruimte" }).click();
      await p.getByRole("menuitem", { name: item, exact: true }).click();
      await p.waitForTimeout(500);
    };
    const chatBreed = async () => (await p.locator(".flexlayout__tabset", { has: p.locator(".flexlayout__tab_button", { hasText: "Gesprek" }) }).first().boundingBox())?.width ?? 0;
    await menu("Standaard");
    const standaard = await chatBreed();
    await menu("Veel gesprek");
    const veelChat = await chatBreed();
    if (!compact) check(tag("'Veel gesprek' maakt het gesprek breder"), veelChat > standaard, `${standaard} → ${veelChat}`);
    await menu("Herstel standaardindeling");
    check(tag("'Herstel standaardindeling' zet de standaard terug"), Math.abs((await chatBreed()) - standaard) < 4);

    // ---- Klikdoelen
    const klein = await p.evaluate(() =>
      [...document.querySelectorAll("button:not([role=checkbox]),[role=radio],[role=tab]")]
        .filter((e) => !e.closest(".flexlayout__tabset") && !e.closest(".flexlayout__tab_toolbar"))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 32 || r.height < 32); })
        .map((e) => `${e.getAttribute("aria-label") ?? e.textContent?.slice(0, 20)}`),
    );
    check(tag("klikdoelen ≥ 32px"), klein.length === 0, klein.join(", "));

    // ---- Visuele regressie
    const nieuw = `/tmp/ux-test-${naam}.png`;
    await p.screenshot({ path: nieuw });
    const basis = `${BASIS}/${naam}.png`;
    if (update || !existsSync(basis)) copyFileSync(nieuw, basis);
    else {
      let verschil = 0;
      try {
        execFileSync("compare", ["-metric", "AE", "-fuzz", "3%", basis, nieuw, "/tmp/ux-diff.png"], { stdio: ["ignore", "ignore", "pipe"] });
      } catch (e) {
        verschil = Number(String(e.stderr).trim().split(" ")[0]) || 1;
      }
      check(tag("screenshot lijkt op basis"), verschil <= vw * vh * 0.01 * scale * scale, `${verschil}px verschillen`);
    }
    await ctx.close();
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error(`\nUX-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log(`UX-test: alles goed op ${FORMATEN.length} formaten${update ? " (basis bijgewerkt)" : ""}.`);

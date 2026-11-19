// Toegankelijkheid van de NIEUWE schermen (homescherm, werkruimte, menu-onderdelen, dialogen) met axe-core:
// licht en donker, drie schermformaten, plus controle op horizontaal scrollen en te kleine klikdoelen.
// Gebruik: node scripts/ux-a11y.mjs   (afsluitcode 1 bij schendingen)
import { readFileSync } from "node:fs";
import { openApp, stop } from "./ux-sim.mjs";

const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
const seed = [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }];
const schermen = {
  homescherm: async () => {},
  eerstestart: null,
  werkruimte: async (p) => {
    await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
    await p.getByTestId("menu").waitFor();
  },
  ...Object.fromEntries(["start", "schermen", "uiterlijk", "bestanden", "onlinezetten", "appwinkel", "versies", "instellingen"].map((id) => [
    id,
    async (p) => {
      await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
      await p.getByTestId(`menu-${id}`).click();
      await p.waitForTimeout(400);
    },
  ])),
  hulp: async (p) => {
    await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
    await p.getByTestId("menu-hulp").click();
    await p.waitForTimeout(400);
  },
};
const formaten = [[1280, 720], [1366, 768], [1920, 1080]];
let bad = 0;
try {
  for (const theme of ["licht", "donker"]) {
    for (const [naam, open] of Object.entries(schermen)) {
      // Het eerste formaat voor alle schermen; de andere twee alleen voor home, werkruimte en instellingen (houdt de test snel).
      const lijst = ["homescherm", "werkruimte", "instellingen"].includes(naam) ? formaten : [formaten[0]];
      for (const [w, h] of lijst) {
        const { page, errors } = await openApp({ w, h, theme, scenario: { seed, eersteStart: naam === "eerstestart" } });
        if (open) {
          await page.getByTestId("home").waitFor();
          await open(page);
        } else await page.getByTestId("eerste-start").waitFor();
        await page.waitForTimeout(400);
        await page.evaluate(axeSource);
        const res = await page.evaluate(async () =>
          // eslint-disable-next-line no-undef
          axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, resultTypes: ["violations"] }),
        );
        const v = res.violations.map((x) => ({ ...x, nodes: x.nodes.filter((n) => !/iframe|xterm/.test(n.target.join(" "))) })).filter((x) => x.nodes.length);
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const klein = await page.evaluate(() =>
          [...document.querySelectorAll("button, a[href], [role=tab], [role=menuitem], input, [role=switch], [role=checkbox]")]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              const cs = getComputedStyle(e);
              return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("iframe, .xterm, [data-testid=project-card]") && (r.height < 24 || r.width < 24);
            })
            .slice(0, 5)
            .map((e) => `${e.tagName.toLowerCase()} ${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
        );
        const problemen = v.length + (scroll ? 1 : 0) + klein.length + errors.length;
        console.log(`${problemen ? "✘" : "✔"} ${naam} ${w}x${h} (${theme})`);
        for (const x of v) {
          bad++;
          console.log(`   - ${x.id} (${x.impact}): ${x.help}`);
          for (const n of x.nodes.slice(0, 3)) console.log(`       ${n.target.join(" ")}`);
        }
        if (scroll) { bad++; console.log("   - horizontaal scrollen"); }
        for (const k of klein) { bad++; console.log(`   - klein klikdoel: ${k}`); }
        for (const e of errors) { bad++; console.log(`   - scriptfout: ${e}`); }
      }
    }
  }
} finally {
  await stop();
}
if (bad) {
  console.error(`\n${bad} probleem/problemen gevonden.`);
  process.exit(1);
}
console.log("\nToegankelijkheid: geen schendingen.");

// Toegankelijkheidscontrole van de belangrijkste schermen (licht en donker) met axe-core, plus een toetsenbordtest.
// Gebruik: node scripts/ui-a11y.mjs        (afsluitcode 1 bij schendingen)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserPath, chromium, openPage, scenes, stop } from "./ui-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const axeSource = readFileSync(path.join(root, "node_modules", "axe-core", "axe.min.js"), "utf8");
const browser = await chromium.launch({ executablePath: browserPath, args: ["--no-sandbox"] });
let bad = 0;

try {
  for (const theme of ["licht", "donker"]) {
    for (const [name, setup] of Object.entries(scenes)) {
      const { page, ctx } = await openPage(browser, theme, name);
      await setup(page);
      await page.waitForTimeout(500);
      await page.evaluate(axeSource);
      const res = await page.evaluate(async () =>
        // eslint-disable-next-line no-undef
        axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, resultTypes: ["violations"] }),
      );
      // De nagebootste preview (een iframe met een demo-site) en de terminal-canvas beoordelen we niet: dat is inhoud van de gebruiker.
      const v = res.violations.map((x) => ({ ...x, nodes: x.nodes.filter((n) => !/iframe|xterm/.test(n.target.join(" "))) })).filter((x) => x.nodes.length);
      console.log(`${v.length ? "✘" : "✔"} ${name} (${theme}): ${v.length} schending(en)`);
      for (const x of v) {
        bad++;
        console.log(`   - ${x.id} (${x.impact}): ${x.help}`);
        for (const n of x.nodes.slice(0, 3)) console.log(`       ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
      }
      await ctx.close();
    }
  }

  // Toetsenbord: alles is met Tab te bereiken en de focus is altijd zichtbaar.
  for (const theme of ["licht", "donker"]) {
    const { page, ctx } = await openPage(browser, theme, "projecten-chat");
    await page.getByText("Kapsalon Mila").first().click();
    await page.waitForTimeout(800);
    await page.mouse.click(2, 2);
    const seen = new Set();
    let invisible = 0;
    for (let i = 0; i < 140; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(220); // focusring heeft een korte overgang
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const visible = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 || cs.boxShadow !== "none";
        // Een iframe (de preview met de pagina van de gebruiker) tekent zijn eigen focus; die beoordelen we niet.
        return { label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), visible: visible || el.tagName === "IFRAME" };
      });
      if (!info) continue;
      seen.add(info.label);
      if (!info.visible) {
        invisible++;
        console.log(`   ✘ geen zichtbare focus op: ${info.label} (${theme})`);
      }
    }
    const need = ["Nieuw project", "Versies", "Technisch", "Kies een afbeelding"].filter((n) => ![...seen].some((s) => s.includes(n)));
    console.log(`${invisible || need.length ? "✘" : "✔"} toetsenbord (${theme}): ${seen.size} elementen bereikt${need.length ? `, niet bereikt: ${need.join(", ")}` : ""}${invisible ? `, ${invisible} zonder zichtbare focus` : ""}`);
    bad += invisible + need.length;
    await ctx.close();
  }
} finally {
  await browser.close();
  await stop();
}
process.exit(bad ? 1 : 0);

// Maakt screenshots van de belangrijkste schermen van Studio, zonder Tauri: de Tauri-aanroepen worden nagebootst.
// Gebruik: node scripts/ui-shots.mjs <voorvoegsel> [licht,donker]      bijv.  node scripts/ui-shots.mjs voor donker
// De afbeeldingen komen in docs/ui/<voorvoegsel>-<scherm>-<thema>.png
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserPath, chromium, openPage, scenes, stop } from "./ui-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = process.argv[2] ?? "na";
const themes = (process.argv[3] ?? "licht,donker").split(",");
const out = path.join(root, "docs", "ui");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: browserPath, args: ["--no-sandbox"] });
try {
  for (const theme of themes) {
    for (const [name, setup] of Object.entries(scenes)) {
      try {
        const { page, ctx } = await openPage(browser, theme, name);
        await setup(page);
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(out, `${prefix}-${name}-${theme}.png`) });
        console.log("✔", `${prefix}-${name}-${theme}.png`);
        await ctx.close();
      } catch (e) {
        console.log("✘", name, theme, String(e.message).split("\n")[0]);
      }
    }
  }
} finally {
  await browser.close();
  await stop();
}

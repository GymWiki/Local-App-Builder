// Draait elk startproject echt in een browser en doet de belangrijkste handelingen: node scripts/ux-templates-test.mjs
// Controleert: laadt zonder fouten, werkt met toetsenbord en klikken, bewaart gegevens, geen horizontale scroll op telefoon en desktop.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const hoofd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(hoofd, "templates");
const { chromium } = createRequire(path.join(hoofd, "mcp-server", "package.json"))("playwright-core");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split("?")[0]).replace(/^\/+/, ""));
  const pad = existsSync(f) && !f.endsWith("/") ? f : path.join(f, "index.html");
  if (!pad.startsWith(root) || !existsSync(pad)) return r.writeHead(404).end();
  r.writeHead(200, { "content-type": TYPES[path.extname(pad)] ?? "text/plain" }).end(readFileSync(pad));
});
await new Promise((res) => server.listen(0, "127.0.0.1", res));
const basis = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.STUDIO_BROWSER_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const fouten = [];
const check = (n, ok, extra = "") => ok || fouten.push(`${n}${extra ? ` (${extra})` : ""}`);

async function open(naam, w, h, scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(`${basis}/${naam}/`);
  return { ctx, p, errors };
}
const geenHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [w, h] of [[390, 844], [1280, 720], [1920, 1080]]) {
  const t = (s) => `${w}x${h}: ${s}`;
  {
    const { ctx, p, errors } = await open("start-takenlijst", w, h);
    check(t("takenlijst: drie voorbeeldtaken"), (await p.locator("#lijst li").count()) === 3);
    await p.fill("#tekst", "Boodschappen doen");
    await p.press("#tekst", "Enter");
    check(t("takenlijst: taak toegevoegd met toetsenbord"), (await p.locator("#lijst li").count()) === 4);
    await p.getByLabel("Klaar: Boodschappen doen").check();
    check(t("takenlijst: telling klopt"), /3 van 4/.test(await p.locator("#telling").innerText()));
    await p.reload();
    check(t("takenlijst: blijft bewaard na herladen"), (await p.locator("#lijst li").count()) === 4 && (await p.getByLabel("Klaar: Boodschappen doen").isChecked()));
    await p.getByLabel("Verwijder: Boodschappen doen").click();
    check(t("takenlijst: verwijderd"), (await p.locator("#lijst li").count()) === 3);
    check(t("takenlijst: geen horizontale scroll"), await geenHScroll(p));
    check(t("takenlijst: geen fouten"), errors.length === 0, errors.join("|"));
    await ctx.close();
  }
  {
    const { ctx, p, errors } = await open("start-portfolio", w, h, "dark");
    check(t("portfolio: drie werkstukken en contactformulier"), (await p.locator("#werk article").count()) === 3 && (await p.locator("#formulier").isVisible()));
    check(t("portfolio: koppen in logische volgorde"), (await p.locator("h1").count()) === 1 && (await p.locator("h2").count()) === 3);
    check(t("portfolio: geen horizontale scroll"), await geenHScroll(p));
    check(t("portfolio: geen fouten"), errors.length === 0, errors.join("|"));
    await ctx.close();
  }
  {
    const { ctx, p, errors } = await open("start-webshop", w, h);
    await p.getByRole("button", { name: /Voeg toe aan mandje: Koffiebonen/ }).click();
    await p.getByRole("button", { name: /Voeg toe aan mandje: Koffiebonen/ }).click();
    await p.getByRole("button", { name: /Voeg toe aan mandje: Mok/ }).click();
    check(t("webshop: totaal klopt (2 × 11,95 + 12,50)"), /36,40/.test(await p.locator("#totaal").innerText()), await p.locator("#totaal").innerText());
    await p.fill("#naam", "Jan");
    await p.fill("#email", "jan@voorbeeld.nl");
    await p.getByRole("button", { name: "Bestelling plaatsen" }).click();
    check(t("webshop: bestelling geplaatst en mandje leeg"), /Bedankt/.test(await p.locator("#melding").innerText()) && (await p.locator("#bestellingen li").count()) === 1 && /0,00/.test(await p.locator("#totaal").innerText()));
    await p.getByRole("button", { name: "Bestelling plaatsen" }).click({ trial: true }).catch(() => undefined);
    await p.fill("#naam", "Piet");
    await p.fill("#email", "piet@voorbeeld.nl");
    await p.getByRole("button", { name: "Bestelling plaatsen" }).click();
    check(t("webshop: lege bestelling wordt vriendelijk geweigerd"), /mandje is leeg/.test(await p.locator("#melding").innerText()));
    check(t("webshop: geen horizontale scroll"), await geenHScroll(p));
    check(t("webshop: geen fouten"), errors.length === 0, errors.join("|"));
    await ctx.close();
  }
  {
    const { ctx, p, errors } = await open("start-kassa", w, h);
    await p.getByRole("button", { name: /Koffie/ }).click();
    await p.getByRole("button", { name: /Appeltaart/ }).click();
    check(t("kassa: totaal klopt (2,80 + 3,95)"), /6,75/.test(await p.locator("#totaal").innerText()));
    await p.getByRole("button", { name: "Afrekenen" }).click();
    check(t("kassa: verkoop staat bij vandaag en het totaal is weer nul"), /1 verkopen/.test(await p.locator("#vandaag").innerText()) && /0,00/.test(await p.locator("#totaal").innerText()));
    await p.reload();
    check(t("kassa: verkoop blijft bewaard"), /1 verkopen/.test(await p.locator("#vandaag").innerText()));
    const klein = await p.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height < 40).length);
    check(t("kassa: alle knoppen minstens 40 px hoog"), klein === 0, String(klein));
    check(t("kassa: geen horizontale scroll"), await geenHScroll(p));
    check(t("kassa: geen fouten"), errors.length === 0, errors.join("|"));
    await ctx.close();
  }
}
await browser.close();
server.close();
if (fouten.length) {
  console.error(`\nStartprojecten-test: ${fouten.length} probleem(en)\n- ${fouten.join("\n- ")}`);
  process.exit(1);
}
console.log("Startprojecten-test: alle vier werken op telefoon, laptop en groot scherm.");

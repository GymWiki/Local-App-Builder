// Bevestigt dat de NIEUWE interface rendert (homescherm met projectkaarten, daarna werkruimte met het nieuwe menu)
// en dat onderaan Instellingen de versie staat. Maakt screenshots in docs/ui/. Gebruik: node scripts/ux-start-check.mjs
import { mkdirSync } from "node:fs";
import { openApp, stop } from "./ux-sim.mjs";

mkdirSync("docs/ui", { recursive: true });
const fouten = [];
const check = (n, ok) => ok || fouten.push(n);
try {
  const { page: p, errors } = await openApp({ w: 1280, h: 800, theme: "licht", scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] } });
  await p.getByTestId("home").waitFor();
  check("homescherm met projectkaarten", (await p.getByRole("button", { name: "Open Hovenier Joke" }).count()) === 1);
  check("geen oude tabs Maken/Publiceren/Geavanceerd", (await p.getByRole("tab", { name: /^(Maken|Publiceren|Geavanceerd)$/ }).count()) === 0);
  await p.screenshot({ path: "docs/ui/start-homescherm.png" });
  await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
  await p.getByTestId("menu").waitFor();
  check("nieuw linkermenu", (await p.getByTestId("menu-versies").count()) === 1);
  await p.screenshot({ path: "docs/ui/start-werkruimte.png" });
  await p.getByTestId("menu-instellingen").click();
  const b = p.getByTestId("build-info");
  await b.scrollIntoViewIfNeeded();
  check("versie onderaan Instellingen", /\d+\.\d+\.\d+/.test(await b.getByTestId("build-versie").innerText()));
  check("commit zichtbaar", (await b.getByTestId("build-commit").innerText()).length > 3);
  await p.screenshot({ path: "docs/ui/start-instellingen-versie.png" });
  check("geen scriptfouten", errors.length === 0);
} finally {
  await stop();
}
if (fouten.length) {
  console.error("Startcontrole mislukt:\n- " + fouten.join("\n- "));
  process.exit(1);
}
console.log("Startcontrole: de nieuwe interface staat er en de versie is zichtbaar.");

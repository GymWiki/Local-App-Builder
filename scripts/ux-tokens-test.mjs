// Controleert de instellingen voor AI-gebruik (Hoeveel mag de AI nadenken, projectkaart, Wat gaat er naar de AI?)
// op 1280x720, 1366x768 en 1920x1080, licht en donker. Gebruik: node scripts/ux-tokens-test.mjs
import { mkdirSync } from "node:fs";
import { openApp, stop } from "./ux-sim.mjs";

mkdirSync("docs/ui", { recursive: true });
const fouten = [];
const check = (n, ok) => ok || fouten.push(n);
try {
  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    for (const theme of ["licht", "donker"]) {
      const naam = `${w}x${h} ${theme}`;
      const { page: p, errors } = await openApp({ w, h, theme, scenario: { seed: [{ naam: "Hovenier Joke", last: "2026-11-10T10:00:00Z" }] } });
      await p.getByTestId("home").waitFor();
      await p.getByRole("button", { name: "Open Hovenier Joke" }).click();
      await p.getByTestId("menu-instellingen").click();
      await p.getByRole("tab", { name: "Mijn AI" }).click();
      const auto = p.getByRole("radio", { name: /Automatisch/ });
      await auto.waitFor();
      check(`${naam}: Automatisch staat standaard aan`, (await auto.getAttribute("aria-checked")) === "true");
      check(`${naam}: geen modelnamen in de gewone weergave`, !/\b(sonnet|opus|haiku|flash)\b/i.test(await p.getByTestId("instellingen").innerText()));
      await p.getByRole("radio", { name: /Zuinig/ }).click();
      check(`${naam}: keuze Zuinig`, (await p.getByRole("radio", { name: /Zuinig/ }).getAttribute("aria-checked")) === "true");
      if (w === 1280 && theme === "licht") await p.screenshot({ path: "docs/ui/tokens-beleid.png" });
      await p.getByRole("tab", { name: "Voor gevorderden" }).click();
      await p.getByTestId("instellingen").getByRole("button", { name: "Voor gevorderden tonen" }).click();
      await p.getByTestId("kaart-vernieuw").click();
      await p.getByTestId("kaart-status").waitFor();
      check(`${naam}: kaartstatus`, /14 bestanden/.test(await p.getByTestId("kaart-status").innerText()));
      check(`${naam}: context-overzicht`, /Projectnotities/.test(await p.getByTestId("context-lijst").innerText()));
      await p.getByTestId("kaart-bekijk").click();
      await p.getByTestId("kaart-tekst").waitFor();
      check(`${naam}: kaart bekijken`, /Projectkaart/.test(await p.getByTestId("kaart-tekst").innerText()));
      if (w === 1280 && theme === "licht") await p.screenshot({ path: "docs/ui/tokens-kaart.png" });
      await p.keyboard.press("Escape");
      const scroll = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(`${naam}: niet horizontaal scrollen`, !scroll);
      check(`${naam}: geen scriptfouten`, errors.length === 0);
    }
  }
} finally {
  await stop();
}
if (fouten.length) {
  console.error("Token-instellingen mislukt:\n- " + fouten.join("\n- "));
  process.exit(1);
}
console.log("Token-instellingen: gelukt op drie formaten, licht en donker.");

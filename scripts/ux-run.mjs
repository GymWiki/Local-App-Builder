// Draait de UX-scenario's: node scripts/ux-run.mjs <joke|daan|sanne|fouten|matrix> [licht,donker]
import { openApp, recorder, stop } from "./ux-sim.mjs";

const which = process.argv[2] ?? "joke";
const themes = (process.argv[3] ?? "licht,donker").split(",");
const OPDRACHT = "maak een website voor mijn bedrijf";

/** Zoekt een knop/tab/link op zichtbare tekst, zoals een gebruiker. Geeft null als hij er niet is (dat is zelf een bevinding). */
async function vind(page, namen, rollen = ["button", "tab", "link", "radio"]) {
  for (const naam of [].concat(namen)) {
    for (const role of rollen) {
      const loc = page.getByRole(role, { name: naam }).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return loc;
    }
  }
  return null;
}
async function klik(page, namen, notities, label) {
  const el = await vind(page, namen);
  if (!el) {
    notities.push(`NIET GEVONDEN: ${label ?? [].concat(namen).join(" / ")}`);
    return false;
  }
  await el.click({ timeout: 3000 }).catch((e) => notities.push(`KLIK MISLUKT (${label}): ${String(e.message).split("\n")[0]}`));
  return true;
}

async function basis(p, rec, notities, { naam = "Hovenier Joke", via = "knop" } = {}) {
  await rec.shot(p, "1-start-eerste-scherm");
  await klik(p, /Nieuw project/, notities);
  await rec.shot(p, "2-nieuw-project-dialoog");
  // leeg proberen te versturen
  await klik(p, /Project aanmaken/, notities);
  await rec.shot(p, "2b-leeg-versturen");
  const veld = p.getByLabel(/Projectnaam/);
  await veld.fill(naam);
  if (via === "enter") {
    await veld.press("Enter");
    await rec.shot(p, "2c-enter-zonder-map");
  }
  await klik(p, /Map kiezen/, notities);
  await rec.shot(p, "2d-naam-en-map-ingevuld");
  await klik(p, /Project aanmaken/, notities);
  await p.waitForTimeout(700);
  await rec.shot(p, "2e-project-aangemaakt");
}

async function opdracht(p, rec, notities, tekst = OPDRACHT, { enter = true } = {}) {
  const veld = p.getByRole("textbox").last();
  await veld.click();
  await veld.fill(tekst);
  await rec.shot(p, "3-opdracht-getypt");
  if (enter) await veld.press("Enter");
  else await klik(p, /^Versturen/, notities);
  await p.waitForTimeout(700);
  await rec.shot(p, "3b-ai-denkt");
  await p.waitForTimeout(1800);
  await rec.shot(p, "3c-ai-bezig");
  await p.waitForTimeout(3500);
  await rec.shot(p, "3d-ai-klaar");
}

async function persoon(naam, cfg, theme) {
  const rec = recorder(naam, theme);
  const notities = [];
  const { page: p, ctx, errors } = await openApp({ ...cfg.view, theme });
  await cfg.flow(p, rec, notities);
  const log = rec.save();
  await ctx.close();
  return { naam, theme, notities, errors, log };
}

const personas = {
  joke: {
    view: { w: 1920, h: 1080, scale: 1.25 },
    async flow(p, rec, n) {
      // Joke kijkt eerst rond en klikt op Instellingen uit nieuwsgierigheid.
      await rec.shot(p, "1-start-eerste-scherm");
      await klik(p, /Instellingen/, n);
      await rec.shot(p, "1b-instellingen-nieuwsgierig");
      await p.keyboard.press("Escape");
      await basis(p, rec, n, { via: "enter" });
      await opdracht(p, rec, n);
      // iets laten aanpassen
      await opdracht(p, rec, n, "maak de kop groen en zet er mijn telefoonnummer bij");
      await klik(p, /Versies/, n);
      await rec.shot(p, "6-versies-dialoog");
      await klik(p, /Terug naar|Zet terug/, n, "Terug naar een eerdere versie");
      await rec.shot(p, "6b-terugzetten-bevestiging");
      await p.keyboard.press("Escape");
      await rec.shot(p, "6c-na-escape");
      await klik(p, /Wissel van AI/, n);
      await rec.shot(p, "7-wissel-van-ai");
      await p.keyboard.press("Escape");
      await klik(p, /AI-accounts/, n);
      await rec.shot(p, "7b-accounts");
      await p.getByLabel(/Label|Naam/).first().fill("Mijn werkaccount").catch(() => n.push("NIET GEVONDEN: veld voor accountnaam"));
      await klik(p, /Account toevoegen/, n);
      await rec.shot(p, "7c-account-toegevoegd");
      await klik(p, /Hovenier Joke/, n, "terug naar het project");
      await klik(p, /Publiceren/, n);
      await rec.shot(p, "8-publiceren");
      await klik(p, /Controleer veiligheid/, n);
      await rec.shot(p, "8b-veiligheid");
      await klik(p, /Download je project/, n);
      await rec.shot(p, "8c-download");
      await klik(p, /Geavanceerd/, n);
      await rec.shot(p, "9a-geavanceerd");
      await klik(p, /Project sluiten/, n, "Project sluiten");
      await rec.shot(p, "9b-sluiten");
      await klik(p, /Hovenier Joke/, n, "project weer openen");
      await rec.shot(p, "9c-weer-open");
    },
  },
  daan: {
    view: { w: 1366, h: 768, scale: 1 },
    async flow(p, rec, n) {
      await basis(p, rec, n, { naam: "Takenlijst", via: "knop" });
      // Daan gebruikt een voorbeeld uit het lege gesprek
      const vb = await vind(p, /Takenlijst-app/);
      if (vb) {
        await rec.shot(p, "3-voorbeelden");
        await vb.click();
      } else n.push("NIET GEVONDEN: voorbeelden in een leeg gesprek");
      await p.waitForTimeout(800);
      await rec.shot(p, "3b-ai-denkt");
      await p.waitForTimeout(5500);
      await rec.shot(p, "3d-ai-klaar");
      await klik(p, /Kies een onderdeel/, n);
      await rec.shot(p, "4-onderdeel-kiezen");
      await klik(p, /Telefoon/, n);
      await rec.shot(p, "4b-telefoon-weergave");
      await klik(p, /Uiterlijk/, n);
      await rec.shot(p, "4c-uiterlijk");
      await klik(p, /Instellingen/, n);
      await klik(p, /Donker/, n, "donker thema");
      await rec.shot(p, "7-thema-wisselen");
      await p.keyboard.press("Escape");
      await klik(p, /Wissel van AI/, n);
      await klik(p, /Maken/, n);
      await klik(p, /Wissel van AI/, n);
      await rec.shot(p, "7b-wissel-van-ai");
      await p.keyboard.press("Escape");
      await klik(p, /Publiceren/, n);
      await rec.shot(p, "8-publiceren");
    },
  },
  sanne: {
    view: { w: 1920, h: 1080, scale: 1 },
    async flow(p, rec, n) {
      await basis(p, rec, n, { naam: "Sanne Coaching & Advies – lange naam met emoji 🌱", via: "knop" });
      const lang = `Maak een website voor mijn coachingpraktijk.\nHoofdstukken: over mij, aanbod, tarieven, reviews, contact.\n${"Een heel lang woord: " + "Zeeuwsevolkstoneelgezelschapsrepetitieruimte".repeat(3)}\nSpeciale tekens: <b>vet</b> & "aanhalingstekens" € % # 😀`;
      const veld = p.getByRole("textbox").last();
      await veld.click();
      await veld.fill(lang);
      await rec.shot(p, "3-lange-opdracht-met-shift-enter");
      await veld.press("Shift+Enter");
      await veld.pressSequentially("nog een regel");
      await rec.shot(p, "3a-extra-regel");
      await veld.press("Enter");
      await p.waitForTimeout(800);
      await rec.shot(p, "3b-ai-denkt");
      await p.waitForTimeout(5500);
      await rec.shot(p, "3d-ai-klaar");
      // venster verkleinen tijdens het gebruik
      for (const [w, h] of [[1280, 720], [1000, 700], [900, 600]]) {
        await p.setViewportSize({ width: w, height: h });
        await p.waitForTimeout(500);
        await rec.shot(p, `4-venster-${w}x${h}`);
      }
      await p.setViewportSize({ width: 1920, height: 1080 });
      // toetsenbord: Tab-volgorde en Escape
      for (let i = 0; i < 6; i++) await p.keyboard.press("Tab");
      await rec.shot(p, "5-tab-focus");
      await klik(p, /Versies/, n);
      await rec.shot(p, "6-versies");
      await p.keyboard.press("Escape");
      await rec.shot(p, "6b-escape-sluit");
      await klik(p, /Publiceren/, n);
      await rec.shot(p, "8-publiceren");
    },
  },
};

const fouten = {
  async offline(p, rec, n) {
    await basis(p, rec, n, { naam: "Fouttest" });
    await opdracht(p, rec, n, OPDRACHT);
  },
  async cli_weg(p, rec, n) {
    await basis(p, rec, n, { naam: "Fouttest" });
    const veld = p.getByRole("textbox").last();
    await veld.fill(OPDRACHT);
    await veld.press("Enter");
    await p.waitForTimeout(900);
    await rec.shot(p, "cli-niet-geinstalleerd");
  },
  async niet_ingelogd(p, rec, n) {
    await basis(p, rec, n, { naam: "Fouttest" });
    await opdracht(p, rec, n, OPDRACHT);
  },
  async mcp_weg(p, rec, n) {
    await basis(p, rec, n, { naam: "Fouttest" });
    await klik(p, /Geavanceerd/, n);
    await rec.shot(p, "mcp-niet-beschikbaar");
  },
};

const matrix = [
  ["minimaal-900x600", 900, 600, 1],
  ["laptop-1280x720", 1280, 720, 1],
  ["laptop-1366x768", 1366, 768, 1],
  ["fullhd-125pct-1536x864", 1920, 1080, 1.25],
  ["fullhd-150pct-1280x720", 1920, 1080, 1.5],
  ["fullhd-1920x1080", 1920, 1080, 1],
  ["groot-2560x1440", 2560, 1440, 1],
];

const alle = [];
try {
  if (personas[which]) {
    for (const theme of themes) alle.push(await persoon(which, personas[which], theme));
  } else if (which === "fouten") {
    for (const [naam, flow] of Object.entries(fouten)) {
      const scenario = { offline: naam === "offline", cliMissing: naam === "cli_weg", notLoggedIn: naam === "niet_ingelogd", mcpDown: naam === "mcp_weg" };
      for (const theme of themes) {
        const rec = recorder(`fout-${naam}`, theme);
        const notities = [];
        const { page, ctx, errors } = await openApp({ w: 1536, h: 864, scale: 1, theme, scenario });
        await flow(page, rec, notities);
        alle.push({ naam: `fout-${naam}`, theme, notities, errors, log: rec.save() });
        await ctx.close();
      }
    }
  } else if (which === "matrix") {
    for (const [naam, w, h, scale] of matrix) {
      for (const theme of themes) {
        const rec = recorder(`matrix/${naam}`, theme);
        const notities = [];
        const { page: p, ctx, errors } = await openApp({ w, h, scale, theme });
        await rec.shot(p, "a-start");
        await klik(p, /Nieuw project/, notities);
        await rec.shot(p, "b-nieuw-project");
        await p.getByLabel(/Projectnaam/).fill("Hovenier Joke");
        await klik(p, /Map kiezen/, notities);
        await klik(p, /Project aanmaken/, notities);
        await p.waitForTimeout(600);
        await rec.shot(p, "c-leeg-gesprek");
        const veld = p.getByRole("textbox").last();
        await veld.fill(OPDRACHT);
        await veld.press("Enter");
        await p.waitForTimeout(7500);
        await rec.shot(p, "d-na-opdracht");
        await klik(p, /Versies/, notities);
        await rec.shot(p, "e-versies");
        await p.keyboard.press("Escape");
        await klik(p, /Geavanceerd/, notities);
        await rec.shot(p, "f-geavanceerd");
        await klik(p, /Publiceren/, notities);
        await rec.shot(p, "g-publiceren");
        await klik(p, /Instellingen/, notities);
        await rec.shot(p, "h-instellingen");
        alle.push({ naam: `matrix/${naam}`, theme, notities, errors, log: rec.save() });
        await ctx.close();
      }
    }
  }
} finally {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`/tmp/ux-${which}.json`, JSON.stringify(alle.map(({ naam, theme, notities, errors }) => ({ naam, theme, notities, errors })), null, 1));
  for (const a of alle) console.log(`${a.naam} (${a.theme}): ${a.log.length} schermen, ${a.notities.length} notities, ${a.errors.length} fouten in console`);
  await stop();
}

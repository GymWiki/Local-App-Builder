// UX-regressietest: node scripts/ux-test.mjs [--update]
// Controleert op zeven venstergroottes (incl. 125/150% schaal) de hoofdflow en vergelijkt screenshots met docs/ux/basis/.
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

try {
  for (const [naam, w, h, scale] of FORMATEN) {
    const { page: p, ctx } = await openApp({ w, h, scale, theme: "licht" });
    const vw = Math.round(w / scale);
    const vh = Math.round(h / scale);
    const tag = (s) => `${naam}: ${s}`;

    // Startscherm: één duidelijke actie, geen scrollbalken.
    check(tag("welkomstknop zichtbaar"), await p.getByRole("button", { name: "Maak je eerste project" }).isVisible());
    check(tag("geen horizontale scroll (start)"), await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    // Nieuw project: knoppen bereikbaar, ook bij het kleinste venster.
    await p.getByRole("button", { name: "Maak je eerste project" }).click();
    await p.getByLabel(/Projectnaam/).fill("Hovenier Joke");
    await p.getByRole("button", { name: /Map kiezen/ }).click();
    const maak = p.getByRole("button", { name: "Project aanmaken" });
    await maak.scrollIntoViewIfNeeded();
    const box = await maak.boundingBox();
    check(tag("'Project aanmaken' binnen beeld"), !!box && box.y >= 0 && box.y + box.height <= vh + 1, JSON.stringify(box));
    await maak.click();
    await p.waitForTimeout(600);

    // Gesprek: invoerveld breed genoeg, verstuurknop zichtbaar, hint aanwezig.
    const veld = p.getByRole("textbox", { name: /Wat wil je maken of veranderen/ });
    const vb = await veld.boundingBox();
    check(tag("invoerveld ≥ 240px breed"), !!vb && vb.width >= 240, JSON.stringify(vb));
    check(tag("invoerveld ≥ 56px hoog"), !!vb && vb.height >= 56, JSON.stringify(vb));
    await veld.fill("Een heel lang woord: " + "Zeeuwsevolkstoneelgezelschapsrepetitieruimte".repeat(3) + "\nregel twee\nregel drie\nregel vier\nregel vijf\nregel zes\nregel zeven");
    const vb2 = await veld.boundingBox();
    check(tag("invoerveld groeit niet boven 220px"), !!vb2 && vb2.height <= Math.max(vh * 0.31, 150), JSON.stringify(vb2));
    const verstuur = p.getByRole("button", { name: "Versturen" });
    await verstuur.scrollIntoViewIfNeeded();
    const sb = await verstuur.boundingBox();
    check(tag("'Versturen' binnen beeld"), !!sb && sb.x >= 0 && sb.x + sb.width <= vw + 1 && sb.y + sb.height <= vh + 1, JSON.stringify(sb));
    check(tag("hint over Enter zichtbaar"), await p.getByText(/Shift \+ Enter begint een nieuwe regel/).isVisible());
    check(tag("geen horizontale scroll (gesprek)"), await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    // Opdracht versturen met Enter.
    await veld.fill("maak een website voor mijn bedrijf");
    await veld.press("Enter");
    await p.waitForTimeout(7500);
    check(tag("AI-antwoord zichtbaar"), await p.getByText(/Wil je dat ik iets verander/).first().isVisible().catch(() => false));
    check(tag("geen horizontale scroll (na opdracht)"), await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    // Klikdoelen: geen knop kleiner dan 32px in de hoofdweergave.
    const klein = await p.evaluate(() =>
      [...document.querySelectorAll("button:not([role=checkbox]),[role=radio],[role=tab]")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 32 || r.height < 32); })
        .map((e) => `${e.getAttribute("aria-label") ?? e.textContent?.slice(0, 20)}`),
    );
    check(tag("klikdoelen ≥ 32px"), klein.length === 0, klein.join(", "));

    // Visuele regressie.
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
      const grens = vw * vh * 0.01; // maximaal 1% afwijkende pixels
      check(tag("screenshot lijkt op basis"), verschil <= grens * scale * scale, `${verschil}px verschillen`);
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

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { listKitIds, validateAll } from "./registry.js";
import { kitJsonSchema, tokensJsonSchema } from "./schema.js";
import { kitTest, kitTry, realRun } from "./kittest.js";
import { checkProject } from "./check.js";

/** Command line voor `npm run kit:validate`, `npm run kit:test -- <id>` en `kit:schema`. */
async function main(argv: string[]): Promise<number> {
  const root = process.env.STUDIO_REPO_ROOT ?? process.cwd();
  const [cmd, ...rest] = argv;
  if (cmd === "validate") {
    const issues = validateAll(root);
    const n = listKitIds(path.join(root, "design-packs")).length;
    if (issues.length === 0) {
      console.log(`✔ ${n} kit(s) goedgekeurd.`);
      return 0;
    }
    for (const i of issues) console.error(`✘ ${i.kit}: ${i.message}`);
    console.error(`\n${issues.length} probleem/problemen gevonden.`);
    return 1;
  }
  if (cmd === "schema") {
    await writeFile(path.join(root, "design-packs", "kit.schema.json"), JSON.stringify(kitJsonSchema(), null, 2) + "\n");
    await writeFile(path.join(root, "design-packs", "tokens.schema.json"), JSON.stringify(tokensJsonSchema(), null, 2) + "\n");
    console.log("✔ design-packs/kit.schema.json en tokens.schema.json geschreven.");
    return 0;
  }
  if (cmd === "test") {
    const preview = rest.includes("--preview");
    let ids = rest.filter((a) => !a.startsWith("--"));
    if (rest.includes("--all")) ids = listKitIds(path.join(root, "design-packs"));
    if (ids.length === 0) {
      console.error("Gebruik: npm run kit:test -- <kit-id> [--preview]   (of --all)");
      return 2;
    }
    let bad = 0;
    for (const id of ids) {
      console.log(`\n== ${id}`);
      const steps = await kitTest({ root, kitId: id, updatePreview: preview, run: realRun, log: (s) => console.log(s) });
      for (const s of steps) {
        const icon = s.status === "gelukt" ? "✔" : s.status === "overgeslagen" ? "–" : "✘";
        console.log(`${icon} ${s.naam}${s.detail ? `\n    ${s.detail.replace(/\n/g, "\n    ")}` : ""}`);
        if (s.status === "mislukt") bad++;
      }
    }
    return bad ? 1 : 0;
  }
  if (cmd === "try") {
    const [id, dir] = rest;
    if (!id || !dir) {
      console.error("Gebruik: npm run kit:try -- <kit-id> <nieuwe-map-buiten-de-repo>");
      return 2;
    }
    const r = await kitTry(root, id, dir);
    console.log(`✔ Proefproject klaar in ${r.dir}\n  pakketten: ${r.plan.join(", ") || "geen"}\n  Bouw er een pagina in (zie docs/ui-kit.md) en draai daarna: npm run kit:check -- ${r.dir}`);
    return 0;
  }
  if (cmd === "check") {
    const [dir] = rest;
    if (!dir) {
      console.error("Gebruik: npm run kit:check -- <projectmap>");
      return 2;
    }
    const res = await checkProject(path.resolve(dir));
    if (!res.enabled) {
      console.error("✘ In deze map is nog geen kit toegepast (design/kit-check.json ontbreekt).");
      return 1;
    }
    for (const f of res.findings) console.error(`✘ ${f.file}:${f.line} [${f.rule}] ${f.message} ${f.fix}`);
    console.log(res.findings.length ? `\n${res.findings.length} afwijking(en) in ${res.scanned} bestanden.` : `✔ Kit-check groen (${res.scanned} bestanden).`);
    return res.findings.length ? 1 : 0;
  }
  console.error("Onbekend commando. Gebruik: validate | test <id> | try <id> <map> | check <map> | schema");
  return 2;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (e) => {
    console.error(`✘ ${(e as Error).message}`);
    process.exit(1);
  },
);

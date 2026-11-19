// Nieuwe versie klaarzetten: npm run release -- 0.2.0
// Zet het versienummer in package.json, src-tauri/tauri.conf.json en src-tauri/Cargo.toml, maakt een commit en een tag (v0.2.0).
// Daarna: git push --follow-tags   (GitHub Actions bouwt dan de installers en zet ze op Releases).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versie = process.argv[2];
if (!versie || !/^\d+\.\d+\.\d+$/.test(versie)) {
  console.error("Gebruik: npm run release -- 0.2.0   (drie getallen, zonder v)");
  process.exit(1);
}
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain")) {
  console.error("Er zijn nog niet-opgeslagen wijzigingen. Commit of stash die eerst.");
  process.exit(1);
}
if (git("tag", "--list", `v${versie}`)) {
  console.error(`De tag v${versie} bestaat al.`);
  process.exit(1);
}

const json = (f, fn) => {
  const p = path.join(root, f);
  const d = JSON.parse(readFileSync(p, "utf8"));
  fn(d);
  writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
};
json("package.json", (d) => (d.version = versie));
json("src-tauri/tauri.conf.json", (d) => (d.version = versie));
const toml = path.join(root, "src-tauri", "Cargo.toml");
writeFileSync(toml, readFileSync(toml, "utf8").replace(/^version = ".*"$/m, `version = "${versie}"`));
// package-lock.json en Cargo.lock volgen het versienummer van het pakket zelf.
const stil = (cmd, args, cwd) => {
  try {
    execFileSync(cmd, args, { cwd, stdio: "ignore", shell: process.platform === "win32" });
  } catch {
    console.warn(`Let op: '${cmd} ${args.join(" ")}' lukte niet; controleer het lock-bestand zelf voor je pusht.`);
  }
};
stil("npm", ["install", "--package-lock-only", "--ignore-scripts"], root);
stil("cargo", ["update", "-p", "studio", "--offline"], path.join(root, "src-tauri"));

git("add", "-A");
git("commit", "-m", `Versie ${versie}`);
git("tag", "-a", `v${versie}`, "-m", `Studio ${versie}`);
console.log(`Klaar: versie ${versie} is gecommit en getagd (v${versie}).\nStuur het nu naar GitHub:  git push --follow-tags`);

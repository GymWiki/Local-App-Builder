import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Run } from "../src/kits/apply.js";
import { applyWithSafety, current, listKits, runScripts, type KitHost } from "../src/kits/ops.js";
import { Git } from "../src/git.js";

const REPO = path.resolve(__dirname, "../..");
const tmps: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "kitops-"));
  tmps.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

/** Packs met fragments-ui plus een tweede kit ("tweede-kit") met een ander pakket, en optioneel een kit met verboden licentie. */
async function packs(): Promise<string> {
  const root = await tmp();
  const p = path.join(root, "design-packs");
  await cp(path.join(REPO, "design-packs"), p, { recursive: true });
  await cp(path.join(p, "fragments-ui"), path.join(p, "tweede-kit"), { recursive: true });
  const f = path.join(p, "tweede-kit", "kit.json");
  const k = JSON.parse(await readFile(f, "utf8"));
  Object.assign(k, { id: "tweede-kit", naam: "Tweede kit", pakketnaam: "tweede-ui", versie: "2.0.0" });
  k.setup.stijlImports = ["tweede-ui/styles.css"];
  k.setup.provider = null;
  await writeFile(f, JSON.stringify(k));
  await cp(path.join(p, "fragments-ui"), path.join(p, "gpl-kit"), { recursive: true });
  const g = JSON.parse(await readFile(path.join(p, "gpl-kit", "kit.json"), "utf8"));
  await writeFile(path.join(p, "gpl-kit", "kit.json"), JSON.stringify({ ...g, id: "gpl-kit", licentie: "GPL-3.0" }));
  return p;
}

async function project(): Promise<string> {
  const dir = await tmp();
  await cp(path.join(REPO, "templates", "web-react-vite"), dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function fakeNpm(opts: { failInstall?: boolean } = {}): { run: Run; calls: string[] } {
  const calls: string[] = [];
  const run: Run = async (command, cwd) => {
    calls.push(command);
    if (opts.failInstall && /npm install/.test(command)) return { exitCode: 1, output: "npm ERR! network" };
    const file = path.join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(file, "utf8"));
    for (const spec of command.split(" ").filter((a) => /^(?:@[\w.-]+\/)?[\w.-]+@\d/.test(a))) {
      const i = spec.lastIndexOf("@");
      pkg.dependencies = { ...pkg.dependencies, [spec.slice(0, i)]: spec.slice(i + 1) };
    }
    if (/npm uninstall/.test(command)) for (const n of command.split(" ").slice(3)) delete pkg.dependencies?.[n];
    await writeFile(file, JSON.stringify(pkg, null, 2));
    return { exitCode: 0, output: "" };
  };
  return { run, calls };
}

function host(dir: string, packsDir: string, over: Partial<KitHost> = {}): KitHost {
  return { projectDir: dir, packsDir, git: new Git(dir), run: fakeNpm().run, checks: async () => ({ ok: true, lines: [] }), ...over };
}

const log = (dir: string) => execFileSync("git", ["log", "--format=%s"], { cwd: dir, encoding: "utf8" }).trim().split("\n");

describe("kit toepassen met veiligheid", () => {
  it("maakt eerst een checkpoint, past toe, controleert en legt het resultaat vast", async () => {
    const dir = await project();
    const out = await applyWithSafety(host(dir, await packs()), "fragments-ui");
    expect(out).toMatchObject({ ok: true, code: "ok", rolledBack: false, switched: false });
    expect(out.before && out.version && out.before !== out.version).toBe(true);
    expect(log(dir)).toEqual(["Nieuw uiterlijk: Fragments UI", "Voor het nieuwe uiterlijk: Fragments UI"]);
    expect(existsSync(path.join(dir, "src/kit/tokens.css"))).toBe(true);
    expect((await current(dir)).kit?.kit).toBe("fragments-ui");
  });

  it("draait automatisch terug als de installatie mislukt en legt uit wat er gebeurde", async () => {
    const dir = await project();
    const out = await applyWithSafety(host(dir, await packs(), { run: fakeNpm({ failInstall: true }).run }), "fragments-ui");
    expect(out).toMatchObject({ ok: false, code: "install_failed", rolledBack: true });
    expect(out.detail).toMatch(/Het installeren lukte niet/);
    expect(existsSync(path.join(dir, "design"))).toBe(false);
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).dependencies["@usefragments/ui"]).toBeUndefined();
    expect(log(dir)[0]).toMatch(/^Voor het nieuwe uiterlijk/); // niets nieuws vastgelegd, geen restore nodig bij mislukte install zonder wijzigingen
  });

  it("draait terug als de controles na het toepassen mislukken, en zet src/main.tsx weer zoals het was", async () => {
    const dir = await project();
    const main = await readFile(path.join(dir, "src/main.tsx"), "utf8");
    const out = await applyWithSafety(host(dir, await packs(), { checks: async () => ({ ok: false, lines: ["[build]", "error TS2322: iets klopt niet"] }) }), "fragments-ui");
    expect(out).toMatchObject({ ok: false, code: "checks_failed", rolledBack: true });
    expect(out.detail).toContain("TS2322");
    expect(await readFile(path.join(dir, "src/main.tsx"), "utf8")).toBe(main);
    expect(existsSync(path.join(dir, "design/kit.json"))).toBe(false);
    expect(existsSync(path.join(dir, "src/kit/tokens.css"))).toBe(false);
    expect(log(dir).some((s) => /^Terug naar/.test(s))).toBe(true);
    expect(log(dir).some((s) => /^Nieuw uiterlijk/.test(s))).toBe(false);
  });

  it("gaat door als de controles niet kunnen draaien, maar zegt dat erbij", async () => {
    const dir = await project();
    const out = await applyWithSafety(host(dir, await packs(), { checks: async () => ({ ok: true, lines: [], skipped: "scripts nog niet goedgekeurd" }) }), "fragments-ui");
    expect(out).toMatchObject({ ok: true, checksSkipped: "scripts nog niet goedgekeurd" });
  });

  it("weigert een kit met niet-toegestane licentie of verkeerde stack zonder iets te wijzigen", async () => {
    const dir = await project();
    const p = await packs();
    const calls = fakeNpm();
    const out = await applyWithSafety(host(dir, p, { run: calls.run }), "gpl-kit");
    expect(out).toMatchObject({ ok: false, code: "refused", rolledBack: false });
    expect(out.detail).toMatch(/niet toegestaan/);
    expect(calls.calls).toEqual([]);
    expect(await Git.prototype.hasCommits.call(new Git(dir))).toBe(false); // zelfs geen checkpoint gemaakt
    expect((await applyWithSafety(host(await tmp(), p), "fragments-ui")).detail).toMatch(/herkent Studio niet/);
  });

  it("wisselt tussen kits: oud pakket weg, nieuw erin, tokens vervangen en terugdraaien kan via het checkpoint", async () => {
    const dir = await project();
    const p = await packs();
    const npm = fakeNpm();
    const h = host(dir, p, { run: npm.run });
    const first = await applyWithSafety(h, "fragments-ui");
    const second = await applyWithSafety(h, "tweede-kit");
    expect(second).toMatchObject({ ok: true, switched: true });
    expect(npm.calls.some((c) => /npm uninstall .*@usefragments\/ui/.test(c))).toBe(true);
    const deps = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).dependencies;
    expect(deps["tweede-ui"]).toBe("2.0.0");
    expect(deps["@usefragments/ui"]).toBeUndefined();
    expect(await readFile(path.join(dir, "src/kit/index.ts"), "utf8")).toContain("tweede-ui/styles.css");
    expect(await readFile(path.join(dir, "src/kit/KitProvider.tsx"), "utf8")).not.toContain("Theme");
    expect((await current(dir)).kit?.kit).toBe("tweede-kit");
    // terug naar de eerste kit via het checkpoint van vóór de wissel
    await new Git(dir).restore(second.before!);
    expect((await current(dir)).kit?.kit).toBe("fragments-ui");
    expect(first.version).toBeTruthy();
  });

  it("past de gekozen aanpassingen meteen toe", async () => {
    const dir = await project();
    await applyWithSafety(host(dir, await packs()), "fragments-ui", { hoofdkleur: "#112233", afronding: "rond" });
    const css = await readFile(path.join(dir, "src/kit/tokens.css"), "utf8");
    expect(css).toContain("--fui-seed-brand: #112233;");
    expect(css).toContain("--fui-radius: 16px;");
  });
});

describe("kitlijst en scripts", () => {
  it("toont kits, markeert welke passen bij de stack en meldt geweigerde kits met reden", async () => {
    const p = await packs();
    const dir = await project();
    const l = await listKits(p, dir);
    expect(l.stack).toBe("react-vite");
    expect(l.kits.map((k) => k.id)).toEqual(["fragments-ui", "tweede-kit"]);
    expect(l.kits[0]).toMatchObject({ compatible: true, licentie: "MIT", attributieVerplicht: false });
    expect(l.kits[0].preview).toMatch(/^data:image\/png;base64,/);
    expect(l.geweigerd).toEqual([{ id: "gpl-kit", reden: expect.stringContaining("niet toegestaan") }]);
    const flutter = await listKits(p, null, "flutter");
    expect(flutter.kits.every((k) => !k.compatible)).toBe(true);
    expect((await listKits(p, null)).kits.every((k) => k.compatible)).toBe(true); // nieuw project: nog geen stack
  });

  it("voert installatiescripts alleen uit voor geldige pakketnamen", async () => {
    const dir = await project();
    const npm = fakeNpm();
    await expect(runScripts({ projectDir: dir, run: npm.run }, ["esbuild", "@scope/pkg"])).resolves.toEqual({ ok: true });
    expect(npm.calls).toEqual(["npm rebuild esbuild @scope/pkg"]);
    await expect(runScripts({ projectDir: dir, run: npm.run }, ["x; rm -rf /"])).rejects.toThrow(/Ongeldige/);
    await expect(runScripts({ projectDir: dir, run: npm.run }, [])).rejects.toThrow();
  });
});

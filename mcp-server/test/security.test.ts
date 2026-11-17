import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mask, missingRls, scanText, securityCheck } from "../src/security.js";

const tmps: string[] = [];
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});
async function project(files: Record<string, string>, git = true): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sec-"));
  tmps.push(dir);
  if (git) execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [f, c] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await writeFile(path.join(dir, f), c);
  }
  return dir;
}
const track = (dir: string) => {
  execFileSync("git", ["add", "-A", "-f"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], { cwd: dir });
};
const codes = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code).sort();

describe("veiligheidscheck", () => {
  it("vindt API-sleutels en tokens in code en toont ze nooit volledig", async () => {
    const sleutel = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const gh = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const dir = await project({ "src/api.ts": `const key = "${sleutel}";\nconst t = '${gh}';\nconst apiKey = "Zx9fQ2LmN8vB4cR7wY1tK";\n` });
    const r = await securityCheck(dir);
    expect(codes(r)).toEqual(["api_key", "api_key", "api_key"]);
    const alles = JSON.stringify(r);
    expect(alles).not.toContain(sleutel);
    expect(alles).not.toContain(gh);
    expect(alles).not.toContain("Zx9fQ2LmN8vB4cR7wY1tK");
    expect(r.findings[0]).toMatchObject({ severity: "hoog", file: "src/api.ts" });
    expect(alles).toContain("sk-a********");
  });

  it("meldt .env- en sleutelbestanden die in git zitten, maar niet .env.example of bestanden buiten git", async () => {
    const dir = await project({ ".env": "TOKEN=abc123\n", ".env.example": "TOKEN=\n", "keys/server.pem": "x", "README.md": "hoi" });
    track(dir);
    const r = await securityCheck(dir);
    expect(r.findings.map((f) => `${f.code}:${f.file}`).sort()).toEqual(["env_in_git:.env", "secret_file_in_git:keys/server.pem"]);
    const schoon = await project({ ".env": "TOKEN=abc123\n", "index.html": "<p>x</p>" });
    execFileSync("git", ["add", "index.html"], { cwd: schoon });
    expect((await securityCheck(schoon)).findings).toEqual([]); // .env staat er wel, maar niet in git en niet in de uitvoer
  });

  it("meldt geheimen in de uitvoermap die online komt", async () => {
    const dir = await project({ "dist/config.js": 'window.k = "AKIAABCDEFGHIJKLMNOP";', "public/.env": "A=1", "build/id_rsa": "x" });
    const r = await securityCheck(dir);
    expect(r.findings.filter((f) => f.code === "secret_in_export").map((f) => f.file).sort()).toEqual(["build/id_rsa", "dist/config.js", "public/.env"]);
  });

  it("vindt vaste wachtwoorden, behalve voorbeeldwaarden en tests", async () => {
    const dir = await project({
      "src/db.ts": 'const config = { user: "admin", password: "S3cureP@ss99" };\nconst x = { password: process.env.PW, wachtwoord: "changeme", pwd: "xxxx" };\n',
      "src/db.test.ts": 'const p = { password: "testwachtwoord123" };\n',
    });
    const r = await securityCheck(dir);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ code: "password", severity: "midden", file: "src/db.ts", line: 1 });
    expect(JSON.stringify(r)).not.toContain("S3cureP@ss99");
  });

  it("vindt Supabase-tabellen zonder toegangsregels en Firebase-regels die alles toestaan", async () => {
    const dir = await project({
      "supabase/migrations/001.sql": "create table public.notities (id int);\ncreate table klanten (id int);\nalter table public.notities enable row level security;\n-- create table commentaar (id int);\n",
      "firestore.rules": "rules_version = '2';\nservice cloud.firestore { match /{d=**} { allow read, write: if true; } }\n",
      "database.rules.json": '{ "rules": { ".read": true, ".write": false } }',
    });
    const r = await securityCheck(dir);
    expect(r.findings.map((f) => `${f.code}:${f.file}`).sort()).toEqual(["db_rules_missing:supabase/migrations/001.sql", "db_rules_open:database.rules.json", "db_rules_open:firestore.rules"]);
    expect(r.findings.find((f) => f.code === "db_rules_missing")!.detail).toContain("klanten");
    expect(missingRls("create table a (x int); alter table a enable row level security;")).toEqual([]);
    expect(missingRls("create table if not exists public.b (x int);")).toEqual(["b"]);
  });

  it("geeft geen valse meldingen op gewone code en slaat node_modules over", async () => {
    const dir = await project({
      "src/App.tsx": 'const apiKey = process.env.API_KEY;\nconst label = "Wachtwoord vergeten?";\nconst secret = "voorbeeld-voorbeeld-voorbeeld";\n',
      "node_modules/pkg/index.js": 'const k = "AKIAABCDEFGHIJKLMNOP";',
      "package.json": '{"name":"x"}',
    });
    expect((await securityCheck(dir)).findings).toEqual([]);
  });

  it("sorteert de ernstigste eerst en de hulpfuncties werken", () => {
    expect(mask("sk-1234567890")).toBe("sk-1********");
    expect(scanText("a.ts", "-----BEGIN RSA PRIVATE KEY-----")[0].code).toBe("private_key");
  });
});

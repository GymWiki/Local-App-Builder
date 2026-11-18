import { describe, expect, it } from "vitest";
import { eersteFout, logsKort, ontdubbel, samenvattingChecks } from "../src/uitvoer.js";
import type { ChecksResult } from "../src/runtime.js";

const stap = (name: string, status: ChecksResult["steps"][number]["status"], output: string[] = []) => ({ name, status, exitCode: status === "passed" ? 0 : 1, durationMs: 2500, output }) as ChecksResult["steps"][number];

describe("zuinige tooluitvoer", () => {
  it("eerste fout: bij voorkeur met bestand en regel", () => {
    expect(eersteFout(["> build", "", "src/app.ts:12:5 - error TS2322: Type fout", "andere error"])).toBe("src/app.ts:12:5 - error TS2322: Type fout");
    expect(eersteFout(["niets bijzonders", "Error: kapot"])).toBe("Error: kapot");
    expect(eersteFout([])).toBeNull();
  });

  it("geslaagde checks zijn een paar regels, mislukte tonen eerst de eerste fout en hooguit 12 regels", () => {
    const lang = Array.from({ length: 150 }, (_, i) => (i === 40 ? "src/a.ts:3 error: stuk" : `regel ${i}`));
    const r: ChecksResult = { ok: false, at: "x", steps: [stap("lint", "passed"), stap("build", "failed", lang)] };
    const t = samenvattingChecks(r);
    expect(t).toContain("CHECKS MISLUKT");
    expect(t).toContain("Eerste fout bij build: src/a.ts:3 error: stuk");
    expect(t.split("\n").length).toBeLessThan(30);
    expect(t).toContain("uitgebreid=true");
    expect(samenvattingChecks(r, true).split("\n").length).toBeGreaterThan(150);
    expect(samenvattingChecks({ ok: true, at: "x", steps: [stap("lint", "passed")] }).split("\n")).toHaveLength(2);
  });

  it("console-fouten worden ontdubbeld en geteld", () => {
    const e = (text: string) => ({ kind: "console" as const, text, at: "t" });
    const t = ontdubbel([...Array.from({ length: 50 }, (_, i) => e(`Failed to load item ${i}`)), e("boom")]);
    expect(t).toContain("51 melding(en), 2 verschillend");
    expect(t).toContain("— 50×");
    expect(ontdubbel([])).toContain("Geen console- of netwerkfouten");
    expect(ontdubbel(Array.from({ length: 30 }, (_, i) => e(`uniek ${"x".repeat(i)}a`)), 5)).toContain("en 25 andere");
  });

  it("logs: korte lijst blijft, lange lijst wordt gefilterd tot fouten en staart", () => {
    const kort = ["a", "b"];
    expect(logsKort(kort, 10)).toEqual(kort);
    const lang = Array.from({ length: 400 }, (_, i) => (i === 100 ? "Error: bij start" : `info ${i}`));
    const k = logsKort(lang, 50);
    expect(k.length).toBeLessThanOrEqual(50);
    expect(k.join("\n")).toContain("Error: bij start");
  });
});

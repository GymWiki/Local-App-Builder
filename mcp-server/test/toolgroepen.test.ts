import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ALLE_GROEPEN, groepenUitArgs } from "../src/groepen.js";
import { Runtime } from "../src/runtime.js";
import { registerTools } from "../src/tools.js";

async function namen(groepen = ALLE_GROEPEN): Promise<{ namen: string[]; tekens: number }> {
  const server = new McpServer({ name: "t", version: "0" });
  registerTools(server, { projectDir: "/tmp/x", projectName: "x", runtime: {} as never }, () => undefined, groepen);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const l = (await client.listTools()).tools;
  await client.close();
  return { namen: l.map((t) => t.name), tekens: l.reduce((n, t) => n + (t.description?.length ?? 0) + JSON.stringify(t.inputSchema).length, 0) };
}

describe("tools per gekoppelde dienst", () => {
  it("zonder koppelingen verdwijnen db-, github- en vercel-tools, de rest blijft", async () => {
    const alles = await namen();
    const leeg = await namen({ db: false, github: false, vercel: false });
    expect(alles.namen.some((n) => n.startsWith("db_"))).toBe(true);
    for (const n of leeg.namen) expect(n).not.toMatch(/^(db_|github_|vercel_)|^git_backup$/);
    for (const n of ["run_checks", "project_kaart", "git_checkpoint", "koppelingen_status", "koppeling_voorstellen", "winkel_status", "needs_data"]) expect(leeg.namen, n).toContain(n);
    expect(leeg.tekens).toBeLessThan(alles.tekens * 0.6);
    console.log(`alle tools: ${alles.namen.length} (${Math.round(alles.tekens / 4)} tokens ≈), zonder koppelingen: ${leeg.namen.length} (${Math.round(leeg.tekens / 4)} tokens ≈)`);
  });
  it("alleen de gekoppelde dienst komt erbij", async () => {
    const g = await namen({ db: false, github: true, vercel: false });
    expect(g.namen).toContain("github_status");
    expect(g.namen).toContain("git_backup");
    expect(g.namen.some((n) => n.startsWith("vercel_") || n.startsWith("db_"))).toBe(false);
  });
  it("groepenUitArgs leest alleen echte ja/nee-waarden; onbekend of onzin betekent tonen", () => {
    expect(groepenUitArgs({ db: false, github: true, vercel: false })).toEqual({ db: false, github: true, vercel: false });
    expect(groepenUitArgs({ db: "nee" })).toEqual(ALLE_GROEPEN);
    expect(groepenUitArgs(null)).toEqual(ALLE_GROEPEN);
    expect(groepenUitArgs(undefined)).toEqual(ALLE_GROEPEN);
  });
  it("de runtime bewaart wat Studio stuurt (tools.set) en toont standaard alles", async () => {
    const rt = new Runtime({ projectDir: "/tmp/x", projectName: "x" });
    expect(rt.toolGroepen).toEqual(ALLE_GROEPEN);
    await rt.control("tools.set", { db: false, github: false, vercel: true });
    expect(rt.toolGroepen).toEqual({ db: false, github: false, vercel: true });
    await rt.close();
  });
});

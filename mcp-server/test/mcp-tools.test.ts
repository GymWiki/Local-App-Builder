import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { startServer, type Running } from "../src/server.js";
import { makeExample, waitFor, type Example } from "./helpers.js";

const TOKEN = "k".repeat(40);
type ToolResult = { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] };
let ex: Example;
let srv: Running;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args }, undefined, { timeout: 90_000 })) as ToolResult;
}
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

beforeEach(async () => {
  ex = await makeExample();
  srv = await startServer({ projectDir: ex.dir, projectName: "Voorbeeld", token: TOKEN });
  client = new Client({ name: "t", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }),
  );
});
afterEach(async () => {
  await client.close();
  await srv.close();
});

describe("MCP-tools (fase 3)", () => {
  it("toont alle tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_console_errors",
      "get_dev_logs",
      "get_last_change",
      "get_preview_screenshot",
      "git_checkpoint",
      "git_list_checkpoints",
      "permission_prompt",
      "project_status",
      "read_project_notes",
      "run_checks",
      "update_project_notes",
    ]);
  });

  it("run_checks weigert niet-goedgekeurde studio.json met een duidelijke melding", async () => {
    const r = await call("run_checks");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/goedgekeurd/);
  });

  it("run_checks, get_dev_logs, git_checkpoint en lijst via MCP", async () => {
    srv.runtime.setTrustedHash(ex.hash);
    let r = await call("run_checks");
    expect(textOf(r)).toContain("ALLE CHECKS GESLAAGD");

    await writeFile(path.join(ex.dir, "fail-build"), "");
    r = await call("run_checks", { steps: ["build"] });
    expect(textOf(r)).toContain("CHECKS MISLUKT");
    expect(textOf(r)).toContain("Error: build broke");

    expect(textOf(await call("get_dev_logs"))).toMatch(/dev-server: stopped/);
    await srv.runtime.dev.start();
    await waitFor("running", () => srv.runtime.dev.status().state === "running");
    expect(textOf(await call("get_dev_logs", { lines: 5 }))).toContain("dev server listening");

    r = await call("git_checkpoint", { bericht: "start" });
    expect(r.isError).toBeFalsy();
    expect(textOf(await call("git_list_checkpoints"))).toContain("start");
    expect(execFileSync("git", ["log", "--format=%s"], { cwd: ex.dir, encoding: "utf8" }).trim()).toBe("start");
  });

  it("get_last_change toont niet-opgeslagen werk en daarna de laatste versie, zonder geheimen en ingekort", async () => {
    await writeFile(path.join(ex.dir, "a.txt"), "eerste\n");
    expect((await call("git_checkpoint", { bericht: "eerste versie" })).isError).toBeFalsy();
    await writeFile(path.join(ex.dir, "a.txt"), "eerste\ntweede regel\n");
    await writeFile(path.join(ex.dir, ".env"), "GEHEIM=hunter2\n");
    await writeFile(path.join(ex.dir, "sleutel.pem"), "PRIVATE KEY\n");
    let t = textOf(await call("get_last_change"));
    expect(t).toContain("nog niet opgeslagen werk");
    expect(t).toContain("+tweede regel");
    expect(t).not.toMatch(/hunter2|PRIVATE KEY|\.env|sleutel\.pem/);
    expect((await call("git_checkpoint", { bericht: "tweede versie" })).isError).toBeFalsy();
    t = textOf(await call("get_last_change"));
    expect(t).toContain("laatste versie — tweede versie");
    expect(t).toContain("+tweede regel");
    expect(t).not.toContain("hunter2");
    const c = await srv.runtime.git.lastChange(10);
    expect(c.truncated).toBe(true);
    expect(c.diff.length).toBe(10);
  });

  it("get_last_change zegt het netjes als er nog niets is om te vergelijken", async () => {
    const r = await call("get_last_change");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Er zijn nog geen versies/);
  });

  it("git_checkpoint eist een korte titel in gewone taal (max 8 woorden)", async () => {
    await writeFile(path.join(ex.dir, "a.txt"), "x");
    const lang = await call("git_checkpoint", { bericht: "een twee drie vier vijf zes zeven acht negen" });
    expect(lang.isError).toBe(true);
    expect(textOf(lang)).toMatch(/maximaal 8 woorden/);
    const goed = await call("git_checkpoint", { bericht: "een twee drie vier vijf zes zeven acht" });
    expect(goed.isError).toBeFalsy();
    expect(textOf(await call("git_list_checkpoints"))).toContain("een twee drie vier vijf zes zeven acht");
  });

  it("screenshot en console-errors uit de preview (slaat over zonder browser)", async (ctx) => {
    srv.runtime.setTrustedHash(ex.hash);
    await srv.runtime.dev.start();
    await waitFor("running", () => srv.runtime.dev.status().state === "running");

    const shot = await call("get_preview_screenshot", { viewport: "mobile" });
    if (shot.isError && /Geen browser/.test(textOf(shot))) return ctx.skip();
    expect(shot.isError).toBeFalsy();
    const img = shot.content.find((c) => c.type === "image")!;
    expect(img.mimeType).toBe("image/jpeg");
    expect(Buffer.from(img.data!, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(img.data!.length).toBeGreaterThan(1000);

    const bad = await call("get_preview_screenshot", { path: "//evil.example/" });
    expect(bad.isError).toBe(true);

    const errs = textOf(await call("get_console_errors"));
    expect(errs).toContain("boom-console");
    expect(errs).toContain("/missing");
    expect(textOf(await call("get_console_errors", { reload: false }))).toContain("Geen console- of netwerkfouten");
  });

  it("screenshot zonder draaiende dev-server geeft een bruikbare foutmelding", async (ctx) => {
    srv.runtime.setTrustedHash(ex.hash);
    const r = await call("get_preview_screenshot");
    if (/Geen browser/.test(textOf(r))) return ctx.skip();
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/niet bereikbaar/);
  });
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Runtime } from "../src/runtime.js";
import { startServer, type Running } from "../src/server.js";
import { waitFor } from "./helpers.js";

const TOKEN = "p".repeat(40);
type R = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: unknown };
let events: Record<string, unknown>[];
let srv: Running;
let client: Client;

async function setup(timeoutMs?: number) {
  events = [];
  const dir = await mkdtemp(path.join(tmpdir(), "studio-perm-"));
  const rt = new Runtime({ projectDir: dir, projectName: "x", emit: (e) => events.push(e), permissionTimeoutMs: timeoutMs });
  srv = await startServer({ projectDir: dir, projectName: "x", token: TOKEN, runtime: rt });
  client = new Client({ name: "t", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
}

afterEach(async () => {
  await client.close();
  await srv.close();
});

const call = (args: Record<string, unknown>) => client.callTool({ name: "permission_prompt", arguments: args }, undefined, { timeout: 30_000 }) as Promise<R>;
const request = () => events.find((e) => e.event === "permission_request") as { id: string; tool_name: string; input: unknown } | undefined;

describe("permission_prompt (toestemmingen via MCP)", () => {
  beforeEach(() => setup());

  it("geeft pas een antwoord nadat de app 'ja' zegt, als één tekstblok met allow + updatedInput", async () => {
    const pending = call({ tool_name: "Write", input: { file_path: "/p/index.html" }, tool_use_id: "toolu_1" });
    await waitFor("vraag aan de app", () => !!request());
    expect(request()).toMatchObject({ tool_name: "Write", input: { file_path: "/p/index.html" } });
    await srv.runtime.control("permission.answer", { id: request()!.id, allow: true });
    const r = await pending;
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe("text");
    expect(r.structuredContent).toBeUndefined();
    expect(JSON.parse(r.content[0].text!)).toEqual({ behavior: "allow", updatedInput: { file_path: "/p/index.html" } });
  });

  it("'nee' geeft deny met een uitleg", async () => {
    const pending = call({ tool_name: "Bash", input: { command: "rm -rf x" } });
    await waitFor("vraag", () => !!request());
    await srv.runtime.control("permission.answer", { id: request()!.id, allow: false });
    const body = JSON.parse((await pending).content[0].text!);
    expect(body.behavior).toBe("deny");
    expect(body.message).toMatch(/niet toegestaan/);
  });

  it("onleesbare aanvraag wordt geweigerd zonder de gebruiker lastig te vallen", async () => {
    const r = await call({});
    expect(JSON.parse(r.content[0].text!).behavior).toBe("deny");
    expect(request()).toBeUndefined();
  });

  it("onbekende of dubbele antwoorden geven een fout", async () => {
    const pending = call({ tool_name: "Edit", input: {} });
    await waitFor("vraag", () => !!request());
    const id = request()!.id;
    await srv.runtime.control("permission.answer", { id, allow: true });
    await pending;
    await expect(srv.runtime.control("permission.answer", { id, allow: true })).rejects.toThrow(/al beantwoord|Onbekende/);
    await expect(srv.runtime.control("permission.answer", { id: "nope", allow: true })).rejects.toThrow();
  });

  it("sluiten van het project weigert openstaande vragen (geen hangende AI)", async () => {
    const pending = call({ tool_name: "Write", input: { file_path: "a" } });
    await waitFor("vraag", () => !!request());
    await srv.runtime.close();
    expect(JSON.parse((await pending).content[0].text!).behavior).toBe("deny");
  });
});

describe("permission_prompt time-out", () => {
  beforeEach(() => setup(300));

  it("verloopt als nee en meldt dat aan de app", async () => {
    const r = await call({ tool_name: "Write", input: { file_path: "a" } });
    expect(JSON.parse(r.content[0].text!).behavior).toBe("deny");
    expect(events.some((e) => e.event === "permission_expired" && e.id === request()!.id)).toBe(true);
  });
});

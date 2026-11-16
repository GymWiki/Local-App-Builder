import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveInside, PathError } from "../src/paths.js";
import { startServer, type Running } from "../src/server.js";
import type { CallRecord } from "../src/tools.js";

const TOKEN = "t".repeat(40);
let dir: string;
let outside: string;
let srv: Running;
let calls: CallRecord[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "studio-proj-"));
  outside = await mkdtemp(path.join(tmpdir(), "studio-out-"));
  await writeFile(path.join(dir, "PROJECT.md"), "# Test\n\n## Doel\n");
  calls = [];
  srv = await startServer({ projectDir: dir, projectName: "Test", token: TOKEN, onToolCall: (r) => calls.push(r) });
});
afterEach(async () => {
  await srv.close();
});

const url = () => `http://127.0.0.1:${srv.port}/mcp`;
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};
const post = (headers: Record<string, string>) =>
  fetch(url(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(init),
  });

async function client(): Promise<Client> {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url()), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  return c;
}

describe("auth en netwerk", () => {
  it("geeft 401 zonder token", async () => {
    expect((await post({})).status).toBe(401);
  });
  it("geeft 401 met fout token", async () => {
    expect((await post({ authorization: "Bearer " + "x".repeat(40) })).status).toBe(401);
    expect((await post({ authorization: "Bearer kort" })).status).toBe(401);
  });
  it("accepteert het juiste token", async () => {
    expect((await post({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });
  it("luistert alleen op 127.0.0.1 en een willekeurige poort", () => {
    expect(srv.host).toBe("127.0.0.1");
    expect(srv.port).toBeGreaterThan(0);
  });
  it("weigert een vreemde Host-header en Origin", async () => {
    expect((await post({ authorization: `Bearer ${TOKEN}`, origin: "http://evil.example" })).status).toBe(403);
  });
  it("weigert te korte tokens bij opstarten", async () => {
    await expect(startServer({ projectDir: dir, projectName: "x", token: "abc" })).rejects.toThrow();
  });
});

describe("tools", () => {
  it("toont precies drie tools", async () => {
    const c = await client();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["project_status", "read_project_notes", "update_project_notes"]);
    await c.close();
  });

  it("project_status geeft naam, pad, notities en git-status", async () => {
    const c = await client();
    const r = (await c.callTool({ name: "project_status", arguments: {} })) as { content: { text: string }[] };
    const data = JSON.parse(r.content[0].text);
    expect(data.naam).toBe("Test");
    expect(data.project_md).toContain("## Doel");
    expect(typeof data.git_status).toBe("string");
    await c.close();
  });

  it("update_project_notes schrijft alleen PROJECT.md en logt zonder inhoud", async () => {
    const c = await client();
    await c.callTool({ name: "update_project_notes", arguments: { content: "geheim-ding\n", mode: "append" } });
    expect(await readFile(path.join(dir, "PROJECT.md"), "utf8")).toBe("# Test\n\n## Doel\ngeheim-ding\n");
    const rec = calls.find((x) => x.tool === "update_project_notes")!;
    expect(rec.ok).toBe(true);
    expect(JSON.stringify(rec)).not.toContain("geheim-ding");
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    await c.close();
  });

  it("weigert schrijven als PROJECT.md een symlink naar buiten is", async () => {
    const target = path.join(outside, "doel.txt");
    await writeFile(target, "origineel");
    const { rm } = await import("node:fs/promises");
    await rm(path.join(dir, "PROJECT.md"));
    await symlink(target, path.join(dir, "PROJECT.md"));
    const c = await client();
    const r = (await c.callTool({ name: "update_project_notes", arguments: { content: "x" } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    expect(await readFile(target, "utf8")).toBe("origineel");
    expect(calls.at(-1)?.ok).toBe(false);
    await c.close();
  });
});

describe("padvalidatie", () => {
  it("staat paden binnen de projectmap toe, ook als ze nog niet bestaan", async () => {
    expect(await resolveInside(dir, "PROJECT.md")).toBe(path.join(await (await import("node:fs/promises")).realpath(dir), "PROJECT.md"));
    await mkdir(path.join(dir, "sub"));
    await expect(resolveInside(dir, "sub/nieuw/bestand.md")).resolves.toContain("nieuw");
  });
  it.each(["../x", "a/../../x", "..", "/etc/passwd", "ok\0.md"])("weigert %j", async (p) => {
    await expect(resolveInside(dir, p)).rejects.toBeInstanceOf(PathError);
  });
  it("weigert een symlinkmap die naar buiten wijst", async () => {
    await symlink(outside, path.join(dir, "link"));
    await expect(resolveInside(dir, "link/x.md")).rejects.toBeInstanceOf(PathError);
  });
});

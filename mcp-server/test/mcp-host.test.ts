import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Runtime } from "../src/runtime.js";
import { startServer, type Running } from "../src/server.js";
import { waitFor } from "./helpers.js";

const TOKEN = "h".repeat(40);
type R = { isError?: boolean; content: { type: string; text?: string }[] };
let events: Record<string, unknown>[];
let srv: Running;
let client: Client;

beforeEach(async () => {
  events = [];
  const dir = await mkdtemp(path.join(tmpdir(), "studio-host-"));
  const rt = new Runtime({ projectDir: dir, projectName: "x", emit: (e) => events.push(e) });
  srv = await startServer({ projectDir: dir, projectName: "x", token: TOKEN, runtime: rt });
  client = new Client({ name: "t", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
});
afterEach(async () => {
  await client.close();
  await srv.close();
});

const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 }) as Promise<R>;
const requests = () => events.filter((e) => e.event === "host_request") as { id: string; cmd: string; args: Record<string, unknown> }[];

describe("vragen aan de app (host_request)", () => {
  it("koppelingen_status vraagt het aan Studio en geeft alleen wat Studio teruggeeft", async () => {
    const pending = call("koppelingen_status");
    await waitFor("vraag aan de app", () => requests().length === 1);
    expect(requests()[0].cmd).toBe("connect.status");
    await srv.runtime.control("host.answer", { id: requests()[0].id, ok: true, result: [{ id: "github", gekoppeld: true, werkt: true }] });
    const r = await pending;
    expect(JSON.parse(r.content[0].text!)).toEqual({ koppelingen: [{ id: "github", gekoppeld: true, werkt: true }] });
  });

  it("koppeling_voorstellen stuurt dienst en reden naar de app en weigert onbekende diensten", async () => {
    const pending = call("koppeling_voorstellen", { dienst: "vercel", reden: "Om je site online te zetten." });
    await waitFor("vraag aan de app", () => requests().length === 1);
    expect(requests()[0]).toMatchObject({ cmd: "connect.propose", args: { dienst: "vercel", reden: "Om je site online te zetten." } });
    await srv.runtime.control("host.answer", { id: requests()[0].id, ok: true, result: { ok: true } });
    expect((await pending).isError).not.toBe(true);
    expect((await call("koppeling_voorstellen", { dienst: "onbekend", reden: "x" })).isError).toBe(true);
  });

  it("een fout van de app komt als gewone melding bij de AI aan", async () => {
    const pending = call("koppelingen_status");
    await waitFor("vraag aan de app", () => requests().length === 1);
    await srv.runtime.control("host.answer", { id: requests()[0].id, ok: false, error: "Geweigerd door veiligheidsregel." });
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Geweigerd door veiligheidsregel/);
  });

  it("een onbekend antwoord-id wordt geweigerd", async () => {
    await expect(srv.runtime.control("host.answer", { id: "bestaat-niet", ok: true })).rejects.toThrow();
  });

  it("sluiten van het project breekt wachtende vragen af", async () => {
    const pending = call("koppelingen_status");
    await waitFor("vraag aan de app", () => requests().length === 1);
    await srv.runtime.close();
    const r = await pending;
    expect(r.isError).toBe(true);
  });
});

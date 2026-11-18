import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools, toolGroepen, type CallRecord } from "./tools.js";
import { Runtime } from "./runtime.js";

export interface StartOptions {
  projectDir: string;
  projectName: string;
  token: string;
  onToolCall?: (r: CallRecord) => void;
  onClient?: () => void;
  /** Gedeelde runtime (dev-server, checks, git). Zonder opgave maakt de server er zelf een. */
  runtime?: Runtime;
  /** Alleen voor tests; standaard 0 = willekeurige poort. */
  port?: number;
}

export interface Running {
  runtime: Runtime;
  port: number;
  host: string;
  close: () => Promise<void>;
}

const HOST = "127.0.0.1";

function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2_000_000) throw new Error("body te groot");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

export async function startServer(opts: StartOptions): Promise<Running> {
  if (opts.token.length < 16) throw new Error("Token te kort.");
  const ownsRuntime = !opts.runtime;
  const runtime = opts.runtime ?? new Runtime({ projectDir: opts.projectDir, projectName: opts.projectName });
  const ctx = { projectDir: opts.projectDir, projectName: opts.projectName, runtime };
  let allowedHosts: Set<string> = new Set();

  const http: Server = createServer(async (req, res) => {
    try {
      // 1. Auth eerst: zonder geldig token verraadt de server niets anders dan 401.
      if (!tokenOk(req.headers.authorization, opts.token)) return reply(res, 401, "Niet geautoriseerd.");
      // 2. Bescherming tegen DNS-rebinding en browser-requests.
      if (!allowedHosts.has((req.headers.host ?? "").toLowerCase())) return reply(res, 403, "Ongeldige host.");
      if (req.headers.origin) return reply(res, 403, "Ongeldige origin.");
      if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") return reply(res, 404, "Niet gevonden.");
      if (req.method !== "POST") return reply(res, 405, "Alleen POST.");

      opts.onClient?.();
      const body = await readBody(req);
      // Stateless: per verzoek een verse server+transport.
      // Vaste tekst (geen tijd of status): een stabiele voorkant houdt de cache van de aanbieder geldig.
      const server = new McpServer({ name: "studio", version: "0.1.0" }, { instructions: "Studio-tools voor dit project. Begin met project_kaart; gebruik bestanden_voor_taak, zoek_symbool en afhankelijkheden voordat je zelf mappen doorzoekt. Lees alleen het stuk van een bestand dat je nodig hebt." });
      registerTools(server, ctx, (r) => opts.onToolCall?.(r), await toolGroepen(ctx.runtime));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) reply(res, 400, (e as Error).message);
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port ?? 0, HOST, resolve); // nooit 0.0.0.0
  });
  const { port } = http.address() as AddressInfo;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return {
    runtime,
    port,
    host: HOST,
    close: async () => {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
      if (ownsRuntime) await runtime.close();
    },
  };
}

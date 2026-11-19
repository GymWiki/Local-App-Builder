import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { validatePreviewUrl } from "./config.js";
import { PICKER_SCRIPT } from "./picker-script.js";

export const SCRIPT_PATH = "/__studio/picker.js";
const MAX_HTML = 5_000_000;

/** Zet het pickerscript in een HTML-pagina (voor </body>, of aan het eind). Andere tekst blijft ongemoeid. */
export function injectPicker(html: string): string {
  const tag = `<script src="${SCRIPT_PATH}"></script>`;
  const i = html.search(/<\/body\s*>/i);
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

export interface PickerProxy {
  /** Loopback-adres van de proxy; hierin laadt de preview. */
  url: string;
  target: string;
  close(): Promise<void>;
}

/**
 * Een kleine tussenserver alleen voor de preview: stuurt alles door naar de dev-server of statische server van het project
 * en voegt in HTML-pagina's het pickerscript toe. Het project zelf wordt nooit aangepast. Luistert alleen op 127.0.0.1;
 * de bestemming moet ook loopback zijn. WebSocket-verbindingen (hot reload) worden doorgegeven.
 */
export async function startPickerProxy(targetUrl: string): Promise<PickerProxy> {
  const target = new URL(validatePreviewUrl(targetUrl));
  const sockets = new Set<Duplex>();
  const server = http.createServer((req, res) => {
    if (req.url === SCRIPT_PATH) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(PICKER_SCRIPT);
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers["accept-encoding"]; // we moeten de HTML kunnen lezen
    const up = http.request({ host: target.hostname.replace(/^\[|\]$/g, ""), port: target.port || 80, method: req.method, path: req.url, headers }, (ur) => {
      const type = String(ur.headers["content-type"] ?? "");
      if (!/text\/html/i.test(type)) {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      ur.on("data", (c: Buffer) => {
        size += c.length;
        if (size <= MAX_HTML) chunks.push(c);
      });
      ur.on("end", () => {
        const body = size > MAX_HTML ? Buffer.concat(chunks) : Buffer.from(injectPicker(Buffer.concat(chunks).toString("utf8")), "utf8");
        const h = { ...ur.headers, "content-length": String(body.length) };
        delete h["content-encoding"];
        delete h["transfer-encoding"];
        res.writeHead(ur.statusCode ?? 200, h).end(body);
      });
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("De preview is niet bereikbaar.");
    });
    req.pipe(up);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  // Hot reload (WebSocket): ruwe verbinding doorgeven.
  server.on("upgrade", (req, socket, head) => {
    const up = net.connect(Number(target.port || 80), target.hostname.replace(/^\[|\]$/g, ""), () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries({ ...req.headers, host: target.host }).map(([k, v]) => `${k}: ${v}`), "", ""];
      up.write(lines.join("\r\n"));
      if (head.length) up.write(head);
      socket.pipe(up);
      up.pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
    socket.on("close", () => up.destroy());
    up.on("close", () => socket.destroy());
    sockets.add(socket);
    sockets.add(up);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    target: target.toString(),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

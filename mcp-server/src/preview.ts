import { existsSync } from "node:fs";

export interface ConsoleEntry {
  kind: "console" | "pageerror" | "network";
  text: string;
  url?: string;
  at: string;
}

export type Viewport = "desktop" | "mobile";
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
} as const;

// Minimale typen: playwright-core wordt pas bij gebruik geladen.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;
type Browser = any;

const MAX_ENTRIES = 200;
/** Browsers vragen zelf om /favicon.ico; een ontbrekend icoon is geen fout van het project. */
const isFavicon = (url?: string) => !!url && /\/favicon\.ico(?:[?#].*)?$/i.test(url);
const NAV_TIMEOUT = 15_000;

export async function launchBrowser(): Promise<Browser> {
  let pw: any;
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("playwright-core is niet beschikbaar in deze Studio-installatie.");
  }
  const sandboxArgs = typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : [];
  const base = { headless: true, timeout: 30_000, args: sandboxArgs };
  const attempts: Record<string, unknown>[] = [];
  if (process.env.STUDIO_BROWSER_PATH && existsSync(process.env.STUDIO_BROWSER_PATH)) {
    attempts.push({ ...base, executablePath: process.env.STUDIO_BROWSER_PATH });
  }
  // Eigen geïnstalleerde browsers eerst: dan hoeft er niets te worden gedownload.
  attempts.push({ ...base, channel: "chrome" }, { ...base, channel: "msedge" }, { ...base });
  let last: unknown;
  for (const a of attempts) {
    try {
      return await pw.chromium.launch(a);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    "Geen browser gevonden voor screenshots. Installeer Google Chrome of Microsoft Edge (of zet STUDIO_BROWSER_PATH). " +
      `Details: ${String((last as Error)?.message ?? last).split("\n")[0]}`,
  );
}

/** Een onzichtbare browser die de preview bekijkt. Ziet dus wat een nieuwe bezoeker ziet, niet wat de gebruiker zelf in de preview aanklikt. */
export class PreviewObserver {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private entries: ConsoleEntry[] = [];

  constructor(private readonly getUrl: () => Promise<string>) {}

  private add(e: Omit<ConsoleEntry, "at">): void {
    this.entries.push({ ...e, at: new Date().toISOString() });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.page = null;
    this.browser = await launchBrowser();
    this.browser.on("disconnected", () => {
      this.browser = null;
      this.page = null;
    });
    return this.browser;
  }

  private attach(page: Page, origin: string): void {
    page.on("console", (m: any) => {
      const loc = m.location()?.url;
      if (m.type() === "error" && !isFavicon(loc)) this.add({ kind: "console", text: m.text().slice(0, 1000), url: loc });
    });
    page.on("pageerror", (e: Error) => this.add({ kind: "pageerror", text: String(e.stack ?? e.message).slice(0, 1500) }));
    page.on("requestfailed", (r: any) => {
      const failure = r.failure()?.errorText ?? "mislukt";
      if (failure.includes("ERR_ABORTED") || isFavicon(r.url())) return; // genegeerde navigatie/annulering
      this.add({ kind: "network", text: `${r.method()} ${r.url()} → ${failure}`, url: r.url() });
    });
    page.on("response", (r: any) => {
      if (r.status() >= 400 && r.url().startsWith(origin) && !isFavicon(r.url())) {
        this.add({ kind: "network", text: `${r.request().method()} ${r.url()} → HTTP ${r.status()}`, url: r.url() });
      }
    });
  }

  private async goto(page: Page, url: string): Promise<void> {
    try {
      await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
    } catch (e) {
      throw new Error(`Preview niet bereikbaar op ${url}. Draait de dev-server? Start hem in de Preview-tab. (${String((e as Error).message).split("\n")[0]})`);
    }
    await page.waitForTimeout(500); // late fouten na de load
  }

  async screenshot(opts: { viewport?: Viewport; path?: string; fullPage?: boolean }): Promise<{ data: Buffer; width: number; height: number; url: string }> {
    const base = await this.getUrl();
    const target = new URL(opts.path ?? "/", base);
    if (target.origin !== new URL(base).origin) throw new Error("Pad valt buiten de preview-URL.");
    const vp = VIEWPORTS[opts.viewport ?? "desktop"];
    const browser = await this.ensureBrowser();
    const ctx = await browser.newContext(vp);
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT);
      this.attach(page, new URL(base).origin);
      await this.goto(page, target.toString());
      // JPEG houdt het resultaat klein genoeg voor de uitvoerlimiet van de AI-CLI.
      const data: Buffer = await page.screenshot({ type: "jpeg", quality: 70, fullPage: opts.fullPage ?? false, timeout: NAV_TIMEOUT });
      return { data, width: vp.viewport.width, height: vp.viewport.height, url: target.toString() };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  /** Console- en netwerkfouten sinds de vorige aanroep. Standaard wordt de pagina eerst opnieuw geladen. */
  async consoleErrors(reload = true): Promise<ConsoleEntry[]> {
    const base = await this.getUrl();
    const browser = await this.ensureBrowser();
    if (!this.page || this.page.isClosed()) {
      const ctx = await browser.newContext(VIEWPORTS.desktop);
      this.page = await ctx.newPage();
      this.page.setDefaultTimeout(NAV_TIMEOUT);
      this.attach(this.page, new URL(base).origin);
      await this.goto(this.page, base);
    } else if (reload) {
      await this.goto(this.page, base);
    }
    const out = this.entries;
    this.entries = [];
    return out;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    this.page = null;
    if (b) await Promise.race([b.close().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  }
}

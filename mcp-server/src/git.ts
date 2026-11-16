import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const TIMEOUT = 30_000;

export interface Checkpoint {
  hash: string;
  short: string;
  date: string;
  message: string;
}

/** Bestanden die we nooit in een checkpoint stoppen (geheimen). */
const SENSITIVE = [/(^|\/)\.env(\..*)?$/i, /\.(pem|key|p12|pfx)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/i, /(^|\/)\.npmrc$/i, /(^|\/)credentials\.json$/i];
const isSensitive = (p: string) => SENSITIVE.some((r) => r.test(p));

export class Git {
  constructor(private readonly dir: string) {}

  private async run(args: string[], opts: { identity?: boolean } = {}): Promise<string> {
    const pre = ["-c", "core.quotepath=off", "-c", "commit.gpgsign=false"];
    if (opts.identity) pre.push(...(await this.identityArgs()));
    const { stdout } = await exec("git", [...pre, ...args], {
      cwd: this.dir,
      timeout: TIMEOUT,
      windowsHide: true,
      maxBuffer: 10_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    return stdout;
  }

  private async identityArgs(): Promise<string[]> {
    const has = async (k: string) => {
      try {
        return (await this.run(["config", "--get", k])).trim().length > 0;
      } catch {
        return false;
      }
    };
    const args: string[] = [];
    if (!(await has("user.name"))) args.push("-c", "user.name=Studio");
    if (!(await has("user.email"))) args.push("-c", "user.email=studio@localhost");
    return args;
  }

  async isRepo(): Promise<boolean> {
    try {
      return (await this.run(["rev-parse", "--is-inside-work-tree"])).trim() === "true";
    } catch {
      return false;
    }
  }

  async hasCommits(): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--verify", "-q", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<string> {
    return (await this.run(["status", "--porcelain=v1", "--branch"])).trim();
  }

  async isDirty(): Promise<boolean> {
    return (await this.run(["status", "--porcelain=v1"])).trim().length > 0;
  }

  async list(limit = 30): Promise<Checkpoint[]> {
    if (!(await this.hasCommits())) return [];
    const n = Math.min(Math.max(1, Math.floor(limit)), 200);
    const out = await this.run(["log", `-n${n}`, "--format=%H%x1f%h%x1f%aI%x1f%s"]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, short, date, message] = l.split("\x1f");
        return { hash, short, date, message };
      });
  }

  /** `git add -A` + commit, behalve gevoelige bestanden. Geeft niets terug als er niets te committen valt. */
  async checkpoint(message: string): Promise<{ created: boolean; hash?: string; skipped: string[] }> {
    const msg = message.replace(/[\0\r]/g, "").trim();
    if (!msg) throw new Error("Geef een bericht op.");
    if (msg.length > 200) throw new Error("Bericht is te lang (max 200 tekens).");
    if (!(await this.isRepo())) throw new Error("Dit project is geen git-repository.");
    await this.run(["add", "-A"]);
    const staged = (await this.run(["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
    const skipped = staged.filter(isSensitive);
    for (const f of skipped) await this.run(["reset", "-q", "--", f]);
    const left = (await this.run(["diff", "--cached", "--name-only"])).trim();
    if (!left) return { created: false, skipped };
    await this.run(["commit", "--no-verify", "-q", "-m", msg], { identity: true });
    return { created: true, hash: (await this.run(["rev-parse", "HEAD"])).trim(), skipped };
  }

  /**
   * Zet het project terug naar de staat van `hash`, als NIEUWE commit bovenop de geschiedenis.
   * Niets gaat verloren: niet-opgeslagen werk wordt eerst als back-upcheckpoint vastgelegd en alle oude commits blijven bestaan.
   */
  async restore(hash: string): Promise<{ safety?: string; hash: string; unchanged: boolean }> {
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error("Ongeldige checkpoint-id.");
    if (!(await this.isRepo()) || !(await this.hasCommits())) throw new Error("Er zijn nog geen checkpoints.");
    let subject: string;
    let full: string;
    try {
      full = (await this.run(["rev-parse", "--verify", "-q", `${hash}^{commit}`])).trim();
      subject = (await this.run(["log", "-n1", "--format=%s", full])).trim();
    } catch {
      throw new Error("Dat checkpoint bestaat niet.");
    }

    let safety: string | undefined;
    if (await this.isDirty()) {
      const r = await this.checkpoint("Studio: automatische back-up vóór terugzetten");
      if (r.created) safety = r.hash;
      if (await this.isDirty()) {
        // Alleen nog bestanden die we bewust niet committen (geheimen); die blijven onaangeroerd staan.
      }
    }
    const head = (await this.run(["rev-parse", "HEAD"])).trim();
    const sameTree =
      (await this.run(["rev-parse", `${full}^{tree}`])).trim() === (await this.run(["rev-parse", "HEAD^{tree}"])).trim();
    if (sameTree) return { safety, hash: head, unchanged: true };

    await this.run(["read-tree", "-u", "--reset", full]);
    try {
      await this.run(["commit", "--no-verify", "-q", "-m", `Terug naar: ${subject} (${full.slice(0, 7)})`], { identity: true });
    } catch (e) {
      await this.run(["read-tree", "-u", "--reset", "HEAD"]).catch(() => undefined);
      throw e;
    }
    return { safety, hash: (await this.run(["rev-parse", "HEAD"])).trim(), unchanged: false };
  }
}

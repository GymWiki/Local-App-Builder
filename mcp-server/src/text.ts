// eslint-disable-next-line no-control-regex
const ANSI = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

export const stripAnsi = (s: string): string => s.replace(ANSI, "");

/** Ringbuffer van regels; houdt halve regels vast tot de newline binnenkomt. */
export class LineBuffer {
  private lines_: string[] = [];
  private partial = "";
  constructor(
    private readonly maxLines = 1000,
    private readonly maxLen = 2000,
  ) {}

  push(chunk: string): void {
    const parts = (this.partial + stripAnsi(chunk)).split(/\r?\n|\r/);
    this.partial = parts.pop() ?? "";
    for (const p of parts) this.add(p);
    if (this.partial.length > this.maxLen) {
      this.add(this.partial);
      this.partial = "";
    }
  }

  add(line: string): void {
    this.lines_.push(line.length > this.maxLen ? line.slice(0, this.maxLen) + "…" : line);
    if (this.lines_.length > this.maxLines) this.lines_.splice(0, this.lines_.length - this.maxLines);
  }

  last(n: number): string[] {
    const all = this.partial ? [...this.lines_, this.partial] : this.lines_;
    return all.slice(-Math.max(1, n));
  }

  clear(): void {
    this.lines_ = [];
    this.partial = "";
  }
}

const ERROR_RE = /\b(error|errors|failed|failure|fail|fatal|panic|exception|traceback|assertion|cannot|unexpected)\b|✖|✗|×|ERR!/i;

/** Kort een lange uitvoer in tot de regels die ertoe doen: foutregels met context, plus de staart. Maximaal `max` regels. */
export function relevantLines(output: string, max = 200): string[] {
  const all = stripAnsi(output).split(/\r?\n/);
  while (all.length && all[all.length - 1].trim() === "") all.pop();
  const clip = (l: string) => (l.length > 400 ? l.slice(0, 400) + "…" : l);
  if (all.length <= max) return all.map(clip);

  const tail = Math.min(40, Math.floor(max / 4));
  const budget = max - tail - 2; // ruimte voor “…”-markeringen
  const keep = new Set<number>();
  for (let i = 0; i < all.length - tail && keep.size < budget; i++) {
    if (ERROR_RE.test(all[i])) {
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < all.length - tail && keep.size < budget) keep.add(j);
    }
  }
  for (let i = all.length - tail; i < all.length; i++) keep.add(i);

  const out: string[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev !== -1 && i !== prev + 1) out.push("…");
    out.push(clip(all[i]));
    prev = i;
  }
  return out.slice(-max);
}

const rtf = new Intl.RelativeTimeFormat("nl", { numeric: "auto" });

/** "zojuist", "5 minuten geleden", "gisteren", … in gewoon Nederlands. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const sec = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return "zojuist";
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), "day");
  return then.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/** Maakt van een git-bericht een titel voor mensen. */
export function friendlyTitle(message: string): string {
  if (message.startsWith("Studio: automatische back-up")) return "Automatische back-up";
  const m = /^Terug naar: (.*) \([0-9a-f]{7}\)$/.exec(message);
  if (m) return `Teruggezet naar: ${m[1]}`;
  return message;
}

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { lastChecks, runtime, type Checkpoint, type CheckRun, type McpInfo, type Project, type RestoreResult } from "../lib/api";

interface Props {
  project: Project;
  mcp: McpInfo | null;
  /** Wordt verhoogd bij elke checks/git-gebeurtenis zodat de lijsten verversen. */
  tick: number;
  onError: (msg: string) => void;
}

const ICON: Record<string, string> = { passed: "✓", failed: "✗", timeout: "⏱", skipped: "–", warned: "!" };
const COLOR: Record<string, string> = {
  passed: "text-success",
  failed: "text-destructive",
  timeout: "text-warning",
  skipped: "text-muted-foreground",
  warned: "text-warning",
};

function fmt(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

export default function ActivityPanel({ project, mcp, tick, onError }: Props) {
  const { t } = useTranslation();
  const up = mcp?.state === "running" || mcp?.state === "connected";
  const [points, setPoints] = useState<Checkpoint[]>([]);
  const [checks, setChecks] = useState<CheckRun[]>([]);
  const [target, setTarget] = useState<Checkpoint | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(0);
  const fail = useCallback((e: unknown) => onError(t("fout.algemeen", { bericht: String(e) })), [onError, t]);

  useEffect(() => {
    let cancelled = false;
    lastChecks(project.id, 1)
      .then((c) => !cancelled && setChecks(c))
      .catch(() => undefined);
    if (up) {
      runtime<Checkpoint[]>(project.id, "git.list", { limit: 15 })
        .then((l) => !cancelled && setPoints(l))
        .catch(() => !cancelled && setPoints([]));
    }
    return () => {
      cancelled = true;
    };
  }, [project.id, up, tick, local]);

  async function restore() {
    if (!target) return;
    setBusy(true);
    try {
      const r = await runtime<RestoreResult>(project.id, "git.restore", { hash: target.hash });
      setMessage(r.unchanged ? t("activiteit.alGelijk") : r.safety ? t("activiteit.teruggezetMetBackup") : t("activiteit.teruggezet"));
      setLocal((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  const run = checks[0];
  const previous = points[1] ?? null;

  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t("activiteit.checks")}</h3>
        {run ? (
          <div data-testid="last-checks">
            <div className={run.ok ? "text-success" : "text-destructive"}>{run.ok ? t("activiteit.geslaagd") : t("activiteit.mislukt")}</div>
            <ul className="mt-1 space-y-0.5">
              {run.steps.map((s) => (
                <li key={s.name} className="flex justify-between">
                  <span>{t(`activiteit.staplabel.${s.name}`, { defaultValue: s.name })}</span>
                  <span className={COLOR[s.status]}>
                    {ICON[s.status]} {t(`activiteit.stap.${s.status}`)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs text-muted-foreground">{fmt(run.created_at.endsWith("Z") ? run.created_at : run.created_at + "Z")}</div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("activiteit.nogGeenChecks")}</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t("activiteit.tijdlijn")}</h3>
        {!up ? (
          <p className="text-muted-foreground">{t("preview.geenRuntime")}</p>
        ) : points.length === 0 ? (
          <p className="text-muted-foreground">{t("activiteit.nogGeenCheckpoints")}</p>
        ) : (
          <ol data-testid="timeline" className="space-y-2 border-l border-border pl-3">
            {points.map((p, i) => (
              <li key={p.hash} className="group">
                <div className="break-words">{p.message}</div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {p.short} · {fmt(p.date)}
                  </span>
                  {i > 0 && (
                    <button className="hidden text-primary hover:underline group-hover:inline" onClick={() => setTarget(p)}>
                      {t("activiteit.zetTerug")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <button
          disabled={!previous || busy}
          onClick={() => setTarget(previous)}
          className="mt-3 w-full rounded border border-border px-3 py-2 hover:bg-muted disabled:opacity-40"
        >
          {t("activiteit.terug")}
        </button>
        {message && (
          <p role="status" className="mt-2 text-xs text-success">
            {message}
          </p>
        )}
      </section>

      {target && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/50">
          <div role="dialog" aria-label={t("activiteit.terug")} className="w-[28rem] space-y-3 rounded-lg bg-card p-6 shadow-xl">
            <h2 className="text-lg font-semibold">{t("activiteit.terug")}</h2>
            <p>{t("activiteit.bevestig", { bericht: target.message, datum: fmt(target.date) })}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{t("activiteit.uitleg1")}</li>
              <li>{t("activiteit.uitleg2")}</li>
              <li>{t("activiteit.uitleg3")}</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={() => setTarget(null)} className="rounded px-3 py-2 hover:bg-muted">
                {t("nieuw.annuleer")}
              </button>
              <button disabled={busy} onClick={() => void restore()} className="rounded bg-warning text-warning-foreground px-3 py-2 font-medium hover:bg-warning/90 disabled:opacity-50">
                {t("activiteit.bevestigKnop")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

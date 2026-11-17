import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { lastChecks, runtime, type Checkpoint, type CheckRun, type McpInfo, type Project, type RestoreResult } from "@/lib/api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
    <div className="space-y-5 text-base">
      <section>
        <h3 className="mb-2 text-sm tracking-wide text-muted-foreground uppercase">{t("activiteit.checks")}</h3>
        {run ? (
          <Card size="sm" data-testid="last-checks">
            <CardContent className="space-y-1">
              <div className={run.ok ? "font-medium text-success" : "font-medium text-destructive"}>{run.ok ? t("activiteit.geslaagd") : t("activiteit.mislukt")}</div>
              <ul className="mt-1 space-y-1">
                {run.steps.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-2">
                    <span>{t(`activiteit.staplabel.${s.name}`, { defaultValue: s.name })}</span>
                    <span className={`${COLOR[s.status]} whitespace-nowrap`}>
                      {ICON[s.status]} {t(`activiteit.stap.${s.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-sm text-muted-foreground">{fmt(run.created_at.endsWith("Z") ? run.created_at : run.created_at + "Z")}</div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground">{t("activiteit.nogGeenChecks")}</p>
        )}
      </section>

      <Separator />

      <section>
        <h3 className="mb-2 text-sm tracking-wide text-muted-foreground uppercase">{t("activiteit.tijdlijn")}</h3>
        {!up ? (
          <p className="text-muted-foreground">{t("preview.geenRuntime")}</p>
        ) : points.length === 0 ? (
          <p className="text-muted-foreground">{t("activiteit.nogGeenCheckpoints")}</p>
        ) : (
          <ol data-testid="timeline" className="space-y-2 border-l border-border pl-3">
            {points.map((p, i) => (
              <li key={p.hash} className="group">
                <div className="break-words">{p.message}</div>
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    <Badge variant="outline" className="mr-1 font-mono">
                      {p.short}
                    </Badge>
                    {fmt(p.date)}
                  </span>
                  {i > 0 && (
                    <Button variant="link" size="xs" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => setTarget(p)}>
                      {t("activiteit.zetTerug")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <Button variant="outline" className="mt-3 w-full" disabled={!previous || busy} onClick={() => setTarget(previous)}>
          {t("activiteit.terug")}
        </Button>
        {message && (
          <p role="status" className="mt-2 text-sm text-success">
            {message}
          </p>
        )}
      </section>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("activiteit.terug")}</AlertDialogTitle>
            <AlertDialogDescription>{target ? t("activiteit.bevestig", { bericht: target.message, datum: fmt(target.date) }) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
            <li>{t("activiteit.uitleg1")}</li>
            <li>{t("activiteit.uitleg2")}</li>
            <li>{t("activiteit.uitleg3")}</li>
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("nieuw.annuleer")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void restore()}>
              {t("activiteit.bevestigKnop")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

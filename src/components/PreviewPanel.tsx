import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  previewInstall,
  previewRestart,
  previewStart,
  previewStop,
  previewTrustScripts,
  runtime,
  trustStudioConfig,
  type ConfigInfo,
  type McpInfo,
  type PreviewInfo,
  type Project,
} from "@/lib/api";
import { ChevronDownIcon, RotateCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  project: Project;
  mcp: McpInfo | null;
  preview: PreviewInfo | null;
  visible: boolean;
  /** Verhoogt als een dev-server zonder eigen hot reload de pagina moet herladen. */
  reloadNonce?: number;
  autoSwitch?: boolean;
  onAutoSwitch?: (v: boolean) => void;
  onError: (msg: string) => void;
  onRetryMcp?: () => Promise<void> | void;
}

const BADGE: Record<string, string> = {
  running: "border-transparent bg-success/15 text-success",
  starting: "border-transparent bg-accent text-accent-foreground",
  stopping: "border-transparent bg-warning/20 text-warning",
  error: "border-transparent bg-destructive/15 text-destructive",
  idle: "border-transparent bg-muted text-muted-foreground",
};

export default function PreviewPanel({ project, mcp, preview, visible, reloadNonce = 0, autoSwitch = false, onAutoSwitch, onError, onRetryMcp }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [manualReload, setManualReload] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const status = preview?.status ?? "idle";
  const mode = preview?.mode ?? "empty";
  const problem = preview?.problem ?? null;
  const usesRuntime = mode === "node" || mode === "config";
  const runtimeUp = mcp?.state === "running" || mcp?.state === "connected";
  const id = project.id;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  // studio.json-goedkeuring: de commando's tonen die de runtime kent.
  useEffect(() => {
    if (problem?.kind !== "untrusted_config" || !runtimeUp) return;
    let cancelled = false;
    runtime<ConfigInfo>(id, "config.get")
      .then((c) => !cancelled && setConfig(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, problem?.kind, runtimeUp]);

  // Logs van het dev-proces (alleen dev-server-modus) zolang de tab zichtbaar is.
  useEffect(() => {
    if (!usesRuntime || !runtimeUp || !visible) return;
    let cancelled = false;
    const load = () =>
      runtime<string[]>(id, "dev.logs", { lines: 200 })
        .then((l) => !cancelled && setLogs(l))
        .catch(() => undefined);
    void load();
    const timer = status === "idle" ? undefined : setInterval(load, 2000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [id, usesRuntime, runtimeUp, visible, status]);

  const active = status === "starting" || status === "running" || status === "stopping";
  const canStart = !active && !problem?.kind.match(/^(empty|flutter|unsupported|config_invalid|node_|runtime_|deps_missing|untrusted)/) && (mode === "static" || usesRuntime);
  const frameKey = `${manualReload}-${preview?.hmr ? 0 : reloadNonce}`;

  const body = () => {
    if (!problem) return null;
    const k = problem.kind;
    const logOpenByDefault = k === "dev_crashed";
    return (
      <Alert role="alert" data-testid="preview-problem" className="rounded-none border-0 border-b border-border bg-card px-5 py-4 text-base">
        <AlertTitle className="font-semibold text-warning">{t(`preview.probleem.${k}`, { defaultValue: t("preview.probleem.unsupported") })}</AlertTitle>
        <AlertDescription className="space-y-3 text-base">
          <div className="break-words text-muted-foreground">{problem.message}</div>
          {t(`preview.uitleg.${k}`, { defaultValue: "" }) && <div className="text-muted-foreground">{t(`preview.uitleg.${k}`)}</div>}
          {k === "untrusted_scripts" && (
            <ul className="space-y-0.5 font-mono text-sm text-muted-foreground">
              {problem.log.filter((l) => !l.endsWith("=")).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {k === "untrusted_config" && config?.config && (
            <ul className="space-y-0.5 font-mono text-sm text-muted-foreground" data-testid="config-commands">
              {(["dev", "build", "lint", "test"] as const).map((c) => (config.config?.[c] ? <li key={c}>{c}: {config.config[c]}</li> : null))}
            </ul>
          )}
          {(k === "dev_crashed" || k === "node_missing" || k === "node_old" || k === "node_broken" || k === "runtime_unavailable") && problem.log.length > 0 && (
            <Collapsible defaultOpen={logOpenByDefault}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="px-0">
                  {t("preview.laatsteRegels")}
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent forceMount>
                <pre data-testid="problem-log" className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">
                  {problem.log.join("\n")}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className="flex gap-2">
            {k === "deps_missing" && (
              <Button disabled={busy} onClick={() => void run(() => previewInstall(id))}>
                {busy ? t("preview.installeren") : t("preview.installeer")}
              </Button>
            )}
            {k === "untrusted_scripts" && (
              <Button disabled={busy} onClick={() => void run(() => previewTrustScripts(id))} className="bg-warning text-warning-foreground hover:bg-warning/90">
                {t("preview.vertrouwScripts")}
              </Button>
            )}
            {k === "untrusted_config" && (
              <Button
                disabled={busy}
                onClick={() => void run(async () => { await trustStudioConfig(id); await previewStart(id); })}
                className="bg-warning text-warning-foreground hover:bg-warning/90"
              >
                {t("preview.vertrouwStart")}
              </Button>
            )}
            {(k === "node_missing" || k === "node_old" || k === "node_broken" || k === "runtime_unavailable") && (
              <Button disabled={busy} onClick={() => void run(async () => { await onRetryMcp?.(); })}>
                {t("preview.opnieuwProberen")}
              </Button>
            )}
            {k === "static_failed" && (
              <Button disabled={busy} onClick={() => void run(() => previewStart(id))}>
                {t("preview.opnieuwProberen")}
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <Badge data-testid="dev-badge" className={BADGE[status]}>
          {t(`preview.status.${status}`)}
        </Badge>
        {t(`preview.modus.${mode}`, { defaultValue: "" }) && <span className="text-sm text-muted-foreground">{t(`preview.modus.${mode}`)}</span>}
        {preview?.url && <span className="truncate text-sm text-muted-foreground">{preview.url}</span>}
        <div className="ml-auto flex gap-2">
          {canStart && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => previewStart(id))}>
              {t("preview.start")}
            </Button>
          )}
          {active && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => previewStop(id))}>
              {t("preview.stop")}
            </Button>
          )}
          {(active || status === "error") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => previewRestart(id))}>
              {t("preview.herstart")}
            </Button>
          )}
          {status === "running" && (
            <Button size="sm" variant="outline" onClick={() => setManualReload((n) => n + 1)}>
              <RotateCwIcon aria-hidden="true" />
              {t("preview.ververs")}
            </Button>
          )}
        </div>
      </div>

      {usesRuntime && !runtimeUp && !problem && <div className="border-b border-border px-5 py-2 text-sm text-muted-foreground">{t("preview.geenRuntime")}</div>}
      {body()}

      <div className="relative min-h-0 flex-1 bg-background">
        {status === "running" && preview?.url ? (
          <iframe
            key={frameKey}
            title={t("tabs.preview")}
            src={preview.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="h-full w-full bg-background"
          />
        ) : status === "starting" ? (
          <div role="status" className="flex h-full flex-col items-center justify-center gap-4 p-8 text-base text-muted-foreground">
            <Skeleton className="h-40 w-full max-w-md" />
            <span>{t("preview.wachten")}</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-base text-muted-foreground">{t("preview.nietActief")}</div>
        )}
      </div>

      {usesRuntime && (
        <Collapsible className="max-h-56 overflow-auto border-t border-border text-sm">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="m-1">
              {t("preview.logs")}
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent forceMount>
            <pre data-testid="dev-logs" className="px-3 pb-3 font-mono whitespace-pre-wrap text-muted-foreground">
              {logs.length ? logs.join("\n") : t("preview.geenLogs")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
      {onAutoSwitch && (
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-sm text-muted-foreground">
          <Checkbox id="auto-wissel" checked={autoSwitch} onCheckedChange={(c) => onAutoSwitch(c === true)} />
          <Label htmlFor="auto-wissel" className="text-sm font-normal text-muted-foreground">
            {t("preview.autoWissel")}
          </Label>
        </div>
      )}
    </div>
  );
}

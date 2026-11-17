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
} from "../lib/api";

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
  running: "bg-success/15 text-success",
  starting: "bg-accent text-accent-foreground",
  stopping: "bg-warning/20 text-warning",
  error: "bg-destructive/15 text-destructive",
  idle: "bg-muted text-muted-foreground",
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
    return (
      <div role="alert" data-testid="preview-problem" className="space-y-3 border-b border-border bg-card px-5 py-4 text-sm">
        <div className="font-medium text-warning">{t(`preview.probleem.${k}`, { defaultValue: t("preview.probleem.unsupported") })}</div>
        <div className="break-words text-muted-foreground">{problem.message}</div>
        {t(`preview.uitleg.${k}`, { defaultValue: "" }) && <div className="text-muted-foreground">{t(`preview.uitleg.${k}`)}</div>}
        {k === "untrusted_scripts" && (
          <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
            {problem.log.filter((l) => !l.endsWith("=")).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {k === "untrusted_config" && config?.config && (
          <ul className="space-y-0.5 font-mono text-xs text-muted-foreground" data-testid="config-commands">
            {(["dev", "build", "lint", "test"] as const).map((c) => (config.config?.[c] ? <li key={c}>{c}: {config.config[c]}</li> : null))}
          </ul>
        )}
        {(k === "dev_crashed" || k === "node_missing" || k === "node_old" || k === "node_broken" || k === "runtime_unavailable") && problem.log.length > 0 && (
          <details open={k === "dev_crashed"}>
            <summary className="cursor-pointer text-xs text-muted-foreground">{t("preview.laatsteRegels")}</summary>
            <pre data-testid="problem-log" className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs text-muted-foreground">
              {problem.log.join("\n")}
            </pre>
          </details>
        )}
        <div className="flex gap-2">
          {k === "deps_missing" && (
            <button disabled={busy} onClick={() => void run(() => previewInstall(id))} className="rounded bg-primary text-primary-foreground px-3 py-1.5 font-medium hover:bg-primary/90 disabled:opacity-50">
              {busy ? t("preview.installeren") : t("preview.installeer")}
            </button>
          )}
          {k === "untrusted_scripts" && (
            <button disabled={busy} onClick={() => void run(() => previewTrustScripts(id))} className="rounded bg-warning text-warning-foreground px-3 py-1 font-medium hover:bg-warning/90 disabled:opacity-50">
              {t("preview.vertrouwScripts")}
            </button>
          )}
          {k === "untrusted_config" && (
            <button
              disabled={busy}
              onClick={() => void run(async () => { await trustStudioConfig(id); await previewStart(id); })}
              className="rounded bg-warning text-warning-foreground px-3 py-1 font-medium hover:bg-warning/90 disabled:opacity-50"
            >
              {t("preview.vertrouwStart")}
            </button>
          )}
          {(k === "node_missing" || k === "node_old" || k === "node_broken" || k === "runtime_unavailable") && (
            <button disabled={busy} onClick={() => void run(async () => { await onRetryMcp?.(); })} className="rounded bg-primary text-primary-foreground px-3 py-1.5 font-medium hover:bg-primary/90 disabled:opacity-50">
              {t("preview.opnieuwProberen")}
            </button>
          )}
          {k === "static_failed" && (
            <button disabled={busy} onClick={() => void run(() => previewStart(id))} className="rounded bg-primary text-primary-foreground px-3 py-1.5 font-medium hover:bg-primary/90 disabled:opacity-50">
              {t("preview.opnieuwProberen")}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span data-testid="dev-badge" className={`rounded px-2 py-1 text-xs ${BADGE[status]}`}>
          {t(`preview.status.${status}`)}
        </span>
        {t(`preview.modus.${mode}`, { defaultValue: "" }) && <span className="text-xs text-muted-foreground">{t(`preview.modus.${mode}`)}</span>}
        {preview?.url && <span className="truncate text-xs text-muted-foreground">{preview.url}</span>}
        <div className="ml-auto flex gap-2">
          {canStart && (
            <button disabled={busy} onClick={() => void run(() => previewStart(id))} className="rounded bg-primary text-primary-foreground px-3 py-1 hover:bg-primary/90 disabled:opacity-50">
              {t("preview.start")}
            </button>
          )}
          {active && (
            <button disabled={busy} onClick={() => void run(() => previewStop(id))} className="rounded border border-border px-3 py-1 hover:bg-muted disabled:opacity-50">
              {t("preview.stop")}
            </button>
          )}
          {(active || status === "error") && (
            <button disabled={busy} onClick={() => void run(() => previewRestart(id))} className="rounded border border-border px-3 py-1 hover:bg-muted disabled:opacity-50">
              {t("preview.herstart")}
            </button>
          )}
          {status === "running" && (
            <button onClick={() => setManualReload((n) => n + 1)} className="rounded border border-border px-3 py-1 hover:bg-muted">
              {t("preview.ververs")}
            </button>
          )}
        </div>
      </div>

      {usesRuntime && !runtimeUp && !problem && (
        <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">{t("preview.geenRuntime")}</div>
      )}
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
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {status === "starting" ? t("preview.wachten") : t("preview.nietActief")}
          </div>
        )}
      </div>

      {usesRuntime && (
        <details className="max-h-56 overflow-auto border-t border-border text-xs">
          <summary className="cursor-pointer px-3 py-2 text-muted-foreground">{t("preview.logs")}</summary>
          <pre data-testid="dev-logs" className="whitespace-pre-wrap px-3 pb-3 font-mono text-muted-foreground">
            {logs.length ? logs.join("\n") : t("preview.geenLogs")}
          </pre>
        </details>
      )}
      {onAutoSwitch && (
        <label className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={autoSwitch} onChange={(e) => onAutoSwitch(e.target.checked)} />
          {t("preview.autoWissel")}
        </label>
      )}
    </div>
  );
}

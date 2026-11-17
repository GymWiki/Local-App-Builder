import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import McpProblem from "./McpProblem";
import {
  runtime,
  trustStudioConfig,
  type ConfigInfo,
  type DevStatus,
  type McpInfo,
  type Project,
} from "../lib/api";

interface Props {
  project: Project;
  mcp: McpInfo | null;
  dev: DevStatus | null;
  visible: boolean;
  onError: (msg: string) => void;
  onRetryMcp?: () => Promise<void> | void;
}

const BADGE: Record<string, string> = {
  running: "bg-emerald-900 text-emerald-200",
  starting: "bg-sky-900 text-sky-200",
  stopping: "bg-amber-900 text-amber-200",
  error: "bg-red-900 text-red-200",
  stopped: "bg-zinc-800 text-zinc-300",
};

export default function PreviewPanel({ project, mcp, dev, visible, onError, onRetryMcp }: Props) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tick, setTick] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const up = mcp?.state === "running" || mcp?.state === "connected";
  const state = dev?.state ?? "stopped";
  const active = state === "starting" || state === "running" || state === "stopping";

  const fail = useCallback((e: unknown) => onError(t("fout.algemeen", { bericht: String(e) })), [onError, t]);

  // Configuratie opnieuw lezen bij een andere projectstatus, na een actie of als de dev-status verandert.
  useEffect(() => {
    if (!up) return;
    let cancelled = false;
    runtime<ConfigInfo>(project.id, "config.get")
      .then((c) => !cancelled && setInfo(c))
      .catch((e) => !cancelled && fail(e));
    return () => {
      cancelled = true;
    };
  }, [project.id, up, tick, state, fail]);

  // Logs ophalen zolang de preview-tab zichtbaar is en er iets draait.
  useEffect(() => {
    if (!up || !visible) return;
    let cancelled = false;
    const load = () =>
      runtime<string[]>(project.id, "dev.logs", { lines: 200 })
        .then((l) => !cancelled && setLogs(l))
        .catch(() => undefined);
    void load();
    const timer = active || state === "error" ? setInterval(load, 2000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [project.id, up, visible, active, state]);

  async function act(cmd: "dev.start" | "dev.stop" | "dev.restart") {
    setBusy(true);
    try {
      await runtime(project.id, cmd);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function trustAndStart() {
    setBusy(true);
    try {
      await trustStudioConfig(project.id);
      setTick((n) => n + 1);
      await runtime(project.id, "dev.start");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    try {
      await runtime(project.id, "config.init");
      setTick((n) => n + 1);
    } catch (e) {
      fail(e);
    }
  }

  if (!up) {
    return (
      <div className="flex-1">
        {mcp?.state === "unavailable" && (
          <McpProblem
            info={mcp}
            busy={retrying}
            onRetry={() => {
              setRetrying(true);
              void Promise.resolve(onRetryMcp?.()).finally(() => setRetrying(false));
            }}
          />
        )}
        <p className="p-6 text-sm text-zinc-400">{t("preview.geenRuntime")}</p>
      </div>
    );
  }

  const cfg = info?.config;
  const needsTrust = info?.exists && cfg && !info.trusted;
  const url = dev?.url ?? cfg?.previewUrl ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm">
        <span data-testid="dev-badge" className={`rounded px-2 py-1 text-xs ${BADGE[state]}`}>
          {t(`preview.status.${state}`)}
        </span>
        {url && <span className="truncate text-xs text-zinc-500">{url}</span>}
        <div className="ml-auto flex gap-2">
          {!active && cfg?.dev && !needsTrust && (
            <button disabled={busy} onClick={() => void act("dev.start")} className="rounded bg-indigo-600 px-3 py-1 hover:bg-indigo-500 disabled:opacity-50">
              {t("preview.start")}
            </button>
          )}
          {active && (
            <button disabled={busy} onClick={() => void act("dev.stop")} className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800 disabled:opacity-50">
              {t("preview.stop")}
            </button>
          )}
          {(active || state === "error") && (
            <button disabled={busy} onClick={() => void act("dev.restart")} className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800 disabled:opacity-50">
              {t("preview.herstart")}
            </button>
          )}
          {state === "running" && (
            <button onClick={() => setReloadKey((n) => n + 1)} className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
              {t("preview.ververs")}
            </button>
          )}
        </div>
      </div>

      {dev?.error && (
        <div role="alert" className="bg-red-950 px-4 py-2 text-sm text-red-200">
          {dev.error}
        </div>
      )}

      {info && !info.exists && (
        <div className="space-y-3 p-6 text-sm" data-testid="no-config">
          <p>{t("preview.geenConfig")}</p>
          <pre className="rounded bg-zinc-900 p-3 text-xs">{`{\n  "dev": "npm run dev",\n  "build": "npm run build",\n  "lint": "npm run lint",\n  "test": "npm test",\n  "previewUrl": "http://localhost:5173"\n}`}</pre>
          <button onClick={() => void init()} className="rounded bg-indigo-600 px-3 py-2 font-medium hover:bg-indigo-500">
            {t("preview.maakConfig")}
          </button>
        </div>
      )}

      {info?.error && (
        <div role="alert" className="p-6 text-sm text-red-300">
          {t("preview.configFout", { fout: info.error })}
        </div>
      )}

      {needsTrust && (
        <div className="m-4 space-y-3 rounded border border-amber-700 bg-amber-950/40 p-4 text-sm" data-testid="trust-box">
          <p className="font-medium">{t("preview.vertrouwTitel")}</p>
          <p className="text-zinc-300">{t("preview.vertrouwUitleg")}</p>
          <ul className="space-y-1 font-mono text-xs">
            {(["dev", "build", "lint", "test"] as const).map((k) =>
              cfg?.[k] ? (
                <li key={k}>
                  <span className="text-zinc-500">{k}:</span> {cfg[k]}
                </li>
              ) : null,
            )}
          </ul>
          <button disabled={busy} onClick={() => void trustAndStart()} className="rounded bg-amber-600 px-3 py-2 font-medium hover:bg-amber-500 disabled:opacity-50">
            {cfg?.dev ? t("preview.vertrouwStart") : t("preview.vertrouw")}
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-zinc-950">
        {state === "running" && url ? (
          <iframe
            key={reloadKey}
            title={t("tabs.preview")}
            src={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="h-full w-full bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            {state === "starting" ? t("preview.wachten") : t("preview.nietActief")}
          </div>
        )}
      </div>

      <details className="max-h-56 overflow-auto border-t border-zinc-800 text-xs">
        <summary className="cursor-pointer px-3 py-2 text-zinc-400">{t("preview.logs")}</summary>
        <pre data-testid="dev-logs" className="whitespace-pre-wrap px-3 pb-3 font-mono text-zinc-300">
          {logs.length ? logs.join("\n") : t("preview.geenLogs")}
        </pre>
      </details>
    </div>
  );
}

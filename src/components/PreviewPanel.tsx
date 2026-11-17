import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  chatSend,
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
import { ChevronDownIcon, MousePointerClickIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Breedte van het voorbeeld per schermgrootte (alleen de breedte verandert; `null` = de hele breedte). */
export const VIEWPORTS = { telefoon: 390, tablet: 768, computer: null } as const;
export type ViewportKey = keyof typeof VIEWPORTS;

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
  const [viewport, setViewport] = useState<ViewportKey>("computer");
  // Klik-en-beschrijf: de preview laadt via een tussenserver die alleen in de preview een pickerscript toevoegt.
  const frame = useRef<HTMLIFrameElement>(null);
  const [picking, setPicking] = useState(false);
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [pick, setPick] = useState<{ selector: string; tag: string; text: string; path: string } | null>(null);
  const [wish, setWish] = useState("");
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

  const tellFrame = useCallback((on: boolean) => frame.current?.contentWindow?.postMessage({ type: "studio-picker", on }, "*"), []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { type?: string; selector?: string; tag?: string; text?: string; path?: string } | null;
      if (d?.type === "studio-picker-ready") tellFrame(picking);
      else if (d?.type === "studio-pick" && typeof d.selector === "string") {
        setPicking(false);
        setWish("");
        setPick({ selector: d.selector.slice(0, 500), tag: String(d.tag ?? "").slice(0, 30), text: String(d.text ?? "").slice(0, 120), path: String(d.path ?? "/").slice(0, 500) });
      } else if (d?.type === "studio-pick-cancel") setPicking(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [picking, tellFrame]);

  async function togglePick() {
    if (picking) {
      setPicking(false);
      tellFrame(false);
      return;
    }
    await run(async () => {
      if (!proxyUrl) setProxyUrl((await runtime<{ url: string }>(id, "picker.url")).url);
      setPicking(true);
      tellFrame(true);
    });
  }

  async function sendPick() {
    if (!pick || !wish.trim()) return;
    const p = pick;
    setPick(null);
    await run(async () => {
      // Zonder schermafbeelding (bijvoorbeeld geen browser) sturen we de wens toch.
      const path = await runtime<{ path: string }>(id, "picker.shot", { selector: p.selector, path: p.path }).then((r) => r.path).catch(() => null);
      const text = p.text ? ` (met de tekst ‘${p.text}’)` : "";
      const prompt = t("preview.kies.prompt", { tag: p.tag, selector: p.selector, pad: p.path, tekst: text, wens: wish.trim(), beeld: path ? t("preview.kies.beeld") : "" });
      await (path ? chatSend(id, prompt, [path]) : chatSend(id, prompt));
      toast.success(t("preview.kies.verstuurd"));
    });
  }

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
        <div className="ml-auto flex flex-wrap gap-2">
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
          {status === "running" && runtimeUp && (
            <Button size="sm" variant={picking ? "default" : "outline"} aria-pressed={picking} title={t("preview.kies.uitleg")} disabled={busy} onClick={() => void togglePick()}>
              <MousePointerClickIcon aria-hidden="true" />
              {t("preview.kies.knop")}
            </Button>
          )}
          {status === "running" && (
            <ToggleGroup type="single" variant="outline" size="sm" role="radiogroup" aria-label={t("preview.weergave.titel")} value={viewport} onValueChange={(v) => v && setViewport(v as ViewportKey)} spacing={0}>
              {(Object.keys(VIEWPORTS) as ViewportKey[]).map((k) => (
                <ToggleGroupItem key={k} value={k} title={t("preview.weergave.uitleg")} className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {t(`preview.weergave.${k}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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

      <div className={`relative min-h-0 flex-1 ${viewport === "computer" ? "bg-background" : "flex justify-center overflow-auto bg-muted"}`}>
        {status === "running" && preview?.url ? (
          <iframe
            ref={frame}
            key={frameKey}
            title={t("tabs.preview")}
            src={proxyUrl ?? preview.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            data-viewport={viewport}
            style={VIEWPORTS[viewport] ? { width: VIEWPORTS[viewport] } : undefined}
            className={`h-full bg-background ${viewport === "computer" ? "w-full" : "max-w-full shrink-0 border-x border-border"}`}
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

      {picking && (
        <p role="status" className="border-t border-border bg-accent px-3 py-2 text-sm text-accent-foreground">
          {t("preview.kies.bezig")}
        </p>
      )}
      <Dialog open={pick !== null} onOpenChange={(o) => !o && setPick(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("preview.kies.titel")}</DialogTitle>
            <DialogDescription>{pick ? t("preview.kies.gekozen", { tag: pick.tag, tekst: pick.text ? ` — ‘${pick.text}’` : "" }) : ""}</DialogDescription>
          </DialogHeader>
          <label htmlFor="pick-wens" className="text-base font-medium">
            {t("preview.kies.label")}
          </label>
          <Input id="pick-wens" autoFocus value={wish} placeholder={t("preview.kies.plek")} onChange={(e) => setWish(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendPick()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPick(null)}>
              {t("preview.kies.annuleer")}
            </Button>
            <Button disabled={!wish.trim()} onClick={() => void sendPick()}>
              {t("preview.kies.versturen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

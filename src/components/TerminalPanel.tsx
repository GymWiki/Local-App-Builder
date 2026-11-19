import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  cliStatus,
  ptyClose,
  startAi,
  startShell,
  type Account,
  type CliStatus,
  type McpCheck,
  type McpInfo,
  verifyClaudeMcp,
  type Project,
  type Provider,
  type SessionInfo,
} from "@/lib/api";
import { XIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import TerminalView from "./TerminalView";
import InstallGuide from "./InstallGuide";
import McpProblem from "./McpProblem";
import SwitchAiDialog from "./SwitchAiDialog";

export interface Session extends SessionInfo {
  title: string;
  ended: boolean;
}

interface Props {
  project: Project;
  accounts: Account[];
  sessions: Session[];
  mcp: McpInfo | null;
  onSessionsChange: (updater: (prev: Session[]) => Session[]) => void;
  onError: (msg: string) => void;
  onRetryMcp?: () => Promise<void> | void;
}

export function sessionTitle(info: SessionInfo, providerName: string, fallbackShell: string, noAccount: string): string {
  if (info.kind !== "ai") return fallbackShell;
  return `${providerName} · ${info.account_label ?? noAccount}`;
}

export default function TerminalPanel({ project, accounts, sessions, mcp, onSessionsChange, onError, onRetryMcp }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [missing, setMissing] = useState<CliStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<McpCheck | null>(null);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;
  const activeAi = active?.kind === "ai" ? active : null;

  function add(info: SessionInfo) {
    const s: Session = {
      ...info,
      ended: false,
      title: sessionTitle(info, info.provider ? t(`provider.${info.provider}`) : "", t("terminal.shell"), t("terminal.systeemstandaard")),
    };
    onSessionsChange((prev) => [...prev, s]);
    setActiveId(s.id);
    if (info.warnings.length) onError(info.warnings.join(" "));
  }

  function defaultAccountFor(provider: Provider): number | null {
    const def = accounts.find((a) => a.id === project.default_account_id && a.provider === provider);
    return (def ?? accounts.find((a) => a.provider === provider))?.id ?? null;
  }

  async function launch(
    provider: Provider,
    accountId: number | null,
    opts: { handover?: boolean; resume?: boolean } = {},
    alreadyChecked = false,
  ) {
    try {
      if (!alreadyChecked) {
        const status = await cliStatus(provider);
        if (!status.installed) {
          setMissing(status);
          return false;
        }
      }
      setMissing(null);
      add(await startAi(project.id, provider, accountId, opts));
      return true;
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
      return false;
    }
  }

  async function newShell() {
    try {
      setMissing(null);
      add(await startShell(project.id));
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }

  async function close(id: string) {
    await ptyClose(id).catch(() => undefined);
    onSessionsChange((prev) => prev.filter((s) => s.id !== id));
  }

  async function switchTo(provider: Provider, accountId: number | null) {
    setSwitching(false);
    const old = activeAi;
    if (await launch(provider, accountId, { handover: true }) && old) await close(old.id);
  }

  async function retry() {
    setRetrying(true);
    try {
      await onRetryMcp?.();
    } finally {
      setRetrying(false);
    }
  }

  async function verify() {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await verifyClaudeMcp(project.id, defaultAccountFor("claude")));
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setChecking(false);
    }
  }

  const accountName = activeAi ? (activeAi.account_label ?? t("terminal.systeemstandaard")) : null;
  const mcpState = mcp?.state ?? "uit";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" onClick={() => void launch("claude", defaultAccountFor("claude"))}>
          {t("provider.claude")}
        </Button>
        <Button size="sm" onClick={() => void launch("gemini", defaultAccountFor("gemini"))}>
          {t("provider.gemini")}
        </Button>
        <Button size="sm" variant="outline" disabled title={t("terminal.codexUitgeschakeld")}>
          {t("provider.codex")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void newShell()}>
          {t("terminal.nieuweShell")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSwitching(true)} disabled={!activeAi}>
          {t("terminal.wissel")}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge variant="secondary" data-testid="account-badge">
            {activeAi ? t("terminal.actiefAccount", { naam: accountName }) : t("terminal.geenAi")}
          </Badge>
          <Badge
            data-testid="mcp-badge"
            title={mcp?.error ?? undefined}
            className={
              mcpState === "connected"
                ? "border-transparent bg-success/15 text-success"
                : mcpState === "running"
                  ? "border-transparent bg-accent text-accent-foreground"
                  : mcpState === "unavailable"
                    ? "border-transparent bg-destructive/15 text-destructive"
                    : "border-transparent bg-muted text-muted-foreground"
            }
          >
            {t(`mcp.${mcpState}`)}
          </Badge>
          {(mcpState === "running" || mcpState === "connected") && (
            <Button variant="link" size="sm" onClick={() => void verify()} disabled={checking}>
              {checking ? t("mcp.controleBezig") : t("mcp.controleer")}
            </Button>
          )}
        </div>
      </div>

      {mcpState === "unavailable" && <McpProblem info={mcp} busy={retrying} onRetry={() => void retry()} />}
      {check && (
        <Alert role="status" data-testid="mcp-check" className="rounded-none border-0 border-b border-border">
          <AlertDescription className="space-y-1">
            <div className={check.verdict === "connected" ? "text-success" : "text-warning"}>{t(`mcp.controle.${check.verdict}`)}</div>
            {check.output && <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">{check.output}</pre>}
          </AlertDescription>
        </Alert>
      )}
      {activeAi?.provider === "claude" && mcpState === "running" && !check && (
        <div className="border-b border-border bg-accent/40 px-4 py-2 text-sm text-accent-foreground">{t("mcp.goedkeuring")}</div>
      )}
      <div className="flex items-end justify-between gap-2 border-b border-border px-3 pt-1">
        <ScrollArea className="min-w-0 flex-1">
          <div role="tablist" aria-label={t("terminal.tabs")} className="flex gap-1">
            {sessions.map((s) => (
              <Button
                key={s.id}
                role="tab"
                aria-selected={s.id === active?.id}
                variant={s.id === active?.id ? "secondary" : "ghost"}
                size="sm"
                className="rounded-b-none"
                onClick={() => {
                  setActiveId(s.id);
                  setMissing(null);
                }}
              >
                {s.title}
                {s.ended ? " ✕" : ""}
              </Button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        {active && (
          <Button variant="ghost" size="sm" aria-label={t("terminal.sluitTab")} onClick={() => void close(active.id)}>
            <XIcon aria-hidden="true" />
            {t("terminal.sluitTab")}
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {missing ? (
          <InstallGuide key={missing.provider} status={missing} onInstalled={(s) => void launch(s.provider, defaultAccountFor(s.provider), {}, true)} />
        ) : sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-lg text-muted-foreground">{t("terminal.leeg")}</div>
        ) : null}
        {sessions.map((s) => (
          <div key={s.id} className={`absolute inset-0 ${!missing && s.id === active?.id ? "" : "invisible"}`}>
            <TerminalView
              sessionId={s.id}
              active={!missing && s.id === active?.id}
              exitText={(code) => t("terminal.beeindigd", { code: code ?? "?" })}
              onExit={() => onSessionsChange((prev) => prev.map((x) => (x.id === s.id ? { ...x, ended: true } : x)))}
            />
          </div>
        ))}
      </div>

      {switching && activeAi && (
        <SwitchAiDialog accounts={accounts} current={activeAi} onCancel={() => setSwitching(false)} onPick={(p, a) => void switchTo(p, a)} />
      )}
    </div>
  );
}

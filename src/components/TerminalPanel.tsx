import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  cliStatus,
  ptyClose,
  startAi,
  startShell,
  type Account,
  type CliStatus,
  type McpInfo,
  type Project,
  type Provider,
  type SessionInfo,
} from "../lib/api";
import TerminalView from "./TerminalView";
import InstallGuide from "./InstallGuide";
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
}

export function sessionTitle(info: SessionInfo, providerName: string, fallbackShell: string, noAccount: string): string {
  if (info.kind !== "ai") return fallbackShell;
  return `${providerName} · ${info.account_label ?? noAccount}`;
}

export default function TerminalPanel({ project, accounts, sessions, mcp, onSessionsChange, onError }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [missing, setMissing] = useState<CliStatus | null>(null);
  const [switching, setSwitching] = useState(false);

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

  const accountName = activeAi ? (activeAi.account_label ?? t("terminal.systeemstandaard")) : null;
  const mcpState = mcp?.state ?? "uit";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm">
        <button onClick={() => void launch("claude", defaultAccountFor("claude"))} className="rounded bg-indigo-600 px-3 py-1 hover:bg-indigo-500">
          {t("provider.claude")}
        </button>
        <button onClick={() => void launch("gemini", defaultAccountFor("gemini"))} className="rounded bg-indigo-600 px-3 py-1 hover:bg-indigo-500">
          {t("provider.gemini")}
        </button>
        <button disabled title={t("terminal.codexUitgeschakeld")} className="rounded border border-zinc-700 px-3 py-1 text-zinc-500">
          {t("provider.codex")}
        </button>
        <button onClick={() => void newShell()} className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
          {t("terminal.nieuweShell")}
        </button>
        <button
          onClick={() => setSwitching(true)}
          disabled={!activeAi}
          className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800 disabled:opacity-40"
        >
          {t("terminal.wissel")}
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span data-testid="account-badge" className="rounded bg-zinc-800 px-2 py-1">
            {activeAi ? t("terminal.actiefAccount", { naam: accountName }) : t("terminal.geenAi")}
          </span>
          <span
            data-testid="mcp-badge"
            title={mcp?.error ?? undefined}
            className={`rounded px-2 py-1 ${
              mcpState === "connected"
                ? "bg-emerald-900 text-emerald-200"
                : mcpState === "running"
                  ? "bg-sky-900 text-sky-200"
                  : mcpState === "unavailable"
                    ? "bg-red-900 text-red-200"
                    : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {t(`mcp.${mcpState}`)}
          </span>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-3 pt-1">
        {sessions.map((s) => (
          <div key={s.id} className={`flex items-center rounded-t text-sm ${s.id === active?.id ? "bg-zinc-800" : "text-zinc-400"}`}>
            <button role="tab" aria-selected={s.id === active?.id} className="px-3 py-1.5" onClick={() => { setActiveId(s.id); setMissing(null); }}>
              {s.title}
              {s.ended ? " ✕" : ""}
            </button>
            <button aria-label={t("terminal.sluitTab")} className="pr-2 text-zinc-500 hover:text-red-400" onClick={() => void close(s.id)}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        {missing ? (
          <InstallGuide key={missing.provider} status={missing} onInstalled={(s) => void launch(s.provider, defaultAccountFor(s.provider), {}, true)} />
        ) : sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-500">{t("terminal.leeg")}</div>
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

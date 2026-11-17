import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cliStatus, ptyClose, startLogin, type Account, type CliStatus } from "../lib/api";
import TerminalView from "./TerminalView";
import InstallGuide from "./InstallGuide";

export default function LoginModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [missing, setMissing] = useState<CliStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await cliStatus(account.provider);
        if (cancelled) return;
        if (!status.installed) return setMissing(status);
        setMissing(null);
        const s = await startLogin(account.id);
        if (cancelled) return void ptyClose(s.id).catch(() => undefined);
        current.current = s.id;
        setSessionId(s.id);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (current.current) void ptyClose(current.current).catch(() => undefined);
    };
  }, [account.id, account.provider, attempt]);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/50">
      <div role="dialog" aria-label={t("accounts.inloggen")} className="flex h-[32rem] w-[48rem] flex-col rounded-lg bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="font-semibold">
              {t("accounts.inloggenBij", { provider: t(`provider.${account.provider}`), label: account.label })}
            </div>
            <div className="text-xs text-muted-foreground">{t("accounts.inlogUitleg")}</div>
          </div>
          <button onClick={onClose} className="rounded border border-border px-3 py-1 text-sm hover:bg-muted">
            {t("accounts.klaar")}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {error && <p className="p-4 text-destructive">{error}</p>}
          {missing && <InstallGuide status={missing} onInstalled={() => setAttempt((n) => n + 1)} />}
          {sessionId && !missing && <TerminalView sessionId={sessionId} active exitText={(c) => t("terminal.beeindigd", { code: c ?? "?" })} />}
        </div>
      </div>
    </div>
  );
}

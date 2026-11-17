import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[34rem] max-w-3xl flex-col gap-0 p-0 sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border p-4">
          <div>
            <DialogTitle>{t("accounts.inloggenBij", { provider: t(`provider.${account.provider}`), label: account.label })}</DialogTitle>
            <DialogDescription>{t("accounts.inlogUitleg")}</DialogDescription>
          </div>
          <Button variant="outline" onClick={onClose}>
            {t("accounts.klaar")}
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {error && <p className="p-4 text-destructive">{error}</p>}
          {missing && <InstallGuide status={missing} onInstalled={() => setAttempt((n) => n + 1)} />}
          {sessionId && !missing && <TerminalView sessionId={sessionId} active exitText={(c) => t("terminal.beeindigd", { code: c ?? "?" })} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

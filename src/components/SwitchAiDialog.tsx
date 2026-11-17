import { useTranslation } from "react-i18next";
import type { Account, Provider, SessionInfo } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  accounts: Account[];
  current: SessionInfo;
  onCancel: () => void;
  onPick: (provider: Provider, accountId: number | null) => void;
}

const PROVIDERS: Provider[] = ["claude", "gemini"];

export default function SwitchAiDialog({ accounts, current, onCancel, onPick }: Props) {
  const { t } = useTranslation();
  const options = PROVIDERS.flatMap((p) => [
    { provider: p, account: null as Account | null },
    ...accounts.filter((a) => a.provider === p).map((a) => ({ provider: p, account: a })),
  ]).filter((o) => !(o.provider === current.provider && (o.account?.id ?? null) === current.account_id));

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("wissel.titel")}</DialogTitle>
          <DialogDescription>{t("wissel.uitleg")}</DialogDescription>
        </DialogHeader>
        <Alert className="border-warning/40 bg-warning/10 text-warning">
          <AlertDescription className="text-warning">{t("wissel.tip")}</AlertDescription>
        </Alert>
        <ul className="space-y-1">
          {options.map((o) => (
            <li key={`${o.provider}-${o.account?.id ?? "sys"}`}>
              <Button variant="ghost" className="w-full justify-start" onClick={() => onPick(o.provider, o.account?.id ?? null)}>
                {t(`provider.${o.provider}`)} · {o.account?.label ?? t("terminal.systeemstandaard")}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("nieuw.annuleer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

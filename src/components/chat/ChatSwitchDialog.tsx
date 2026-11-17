import { useTranslation } from "react-i18next";
import type { Account, Provider } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  accounts: Account[];
  onCancel: () => void;
  onPick: (provider: Provider, accountId: number | null) => void;
}

const PROVIDERS: Provider[] = ["claude", "gemini"];

export default function ChatSwitchDialog({ accounts, onCancel, onPick }: Props) {
  const { t } = useTranslation();
  const options = PROVIDERS.flatMap((p) => [{ provider: p, account: null as Account | null }, ...accounts.filter((a) => a.provider === p).map((a) => ({ provider: p, account: a }))]);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("chat.wisselDialoog.titel")}</DialogTitle>
          <DialogDescription>{t("chat.wisselDialoog.uitleg")}</DialogDescription>
        </DialogHeader>
        <Alert className="border-warning/40 bg-warning/10">
          <AlertDescription className="text-warning">{t("chat.wisselDialoog.tip")}</AlertDescription>
        </Alert>
        <ul className="space-y-1">
          {options.map((o) => (
            <li key={`${o.provider}-${o.account?.id ?? "sys"}`}>
              <Button variant="ghost" size="lg" className="w-full justify-start" onClick={() => onPick(o.provider, o.account?.id ?? null)}>
                {t(`provider.${o.provider}`)} · {o.account?.label ?? t("chat.geenAccount")}
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

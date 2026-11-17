import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PauseCircleIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  message: ChatMessage;
  /** Alleen de laatste melding heeft knoppen. */
  active: boolean;
  onRestore: (hash: string, title: string) => Promise<void> | void;
  onDiscuss: () => void;
  onOtherAi: () => void;
}

/** Vriendelijke onderbreking als de AI in cirkels draait, met drie duidelijke keuzes. */
export default function LoopAlertCard({ message, active, onRestore, onDiscuss, onOtherAi }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  const working: { hash: string; title: string } | null = p.last_working ?? null;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const reason: string = ["same_error", "same_step", "worse"].includes(p.reason) ? p.reason : "same_error";

  async function restore() {
    if (!working) return;
    setBusy(true);
    try {
      await onRestore(working.hash, working.title);
      setDone(t("chat.lus.terugKlaar", { titel: working.title }));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Alert data-testid="loop-alert" className="space-y-3 border-2 border-warning bg-warning/10 p-5 text-lg">
      <PauseCircleIcon aria-hidden="true" className="text-warning" />
      <AlertTitle className="text-xl font-semibold">{t("chat.lus.titel")}</AlertTitle>
      <AlertDescription className="space-y-3 text-lg text-foreground">
        <p>{t(`chat.lus.uitleg.${reason}`, { aantal: p.streak })}</p>
        {done ? (
          <p role="status" className="rounded-lg bg-success/15 p-3 text-base text-success">
            {done}
          </p>
        ) : (
          active && (
            <>
              <p className="text-base text-muted-foreground">{t("chat.lus.vraag")}</p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" disabled={!working} onClick={() => setConfirm(true)}>
                  {t("chat.lus.terug")}
                </Button>
                <Button size="lg" variant="outline" onClick={onDiscuss}>
                  {t("chat.lus.overleg")}
                </Button>
                <Button size="lg" variant="outline" onClick={onOtherAi}>
                  {t("chat.lus.andere")}
                </Button>
              </div>
              {!working && <p className="text-sm text-muted-foreground">{t("chat.lus.terugGeen")}</p>}
            </>
          )
        )}
      </AlertDescription>
      <AlertDialog open={confirm && !!working} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{working ? t("chat.lus.terugBevestig", { titel: working.title }) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.lus.terugUitleg")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("nieuw.annuleer")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void restore()}>
              {t("chat.lus.terugJa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Alert>
  );
}

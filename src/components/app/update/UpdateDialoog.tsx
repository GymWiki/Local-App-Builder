import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { updateInstall, type UpdateInfo } from "@/lib/api";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Props {
  info: UpdateInfo | null;
  onClose: () => void;
}

/** "Er is een nieuwe versie": wat is er nieuw, nu bijwerken of later. Tijdens het bijwerken een voortgangsbalk. */
export default function UpdateDialoog({ info, onClose }: Props) {
  const { t } = useTranslation();
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState(false);
  const [voortgang, setVoortgang] = useState<{ gedaan: number; totaal: number | null } | null>(null);

  useEffect(() => {
    let weg = false;
    let off: (() => void) | undefined;
    void listen<{ gedaan: number; totaal: number | null }>("update-voortgang", (e) => setVoortgang(e.payload))
      .then((u) => (weg ? u() : (off = u)))
      .catch(() => undefined);
    return () => {
      weg = true;
      off?.();
    };
  }, []);

  async function bijwerken() {
    setBezig(true);
    setFout(false);
    try {
      await updateInstall(); // bij succes start Studio opnieuw op
    } catch {
      setFout(true);
      setBezig(false);
    }
  }

  const klaar = voortgang && voortgang.totaal ? voortgang.gedaan >= voortgang.totaal : false;
  return (
    <AlertDialog open={!!info && info.status === "beschikbaar"} onOpenChange={(o) => !o && !bezig && onClose()}>
      <AlertDialogContent data-testid="update-dialoog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("update.dialoog.titel")}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">{t("update.dialoog.uitleg", { nieuw: info?.nieuw ?? "", versie: info?.versie_nu ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        {info?.notities && (
          <div data-testid="update-notities" className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
            <p className="mb-1 font-medium">{t("update.dialoog.notities")}</p>
            {info.notities}
          </div>
        )}
        {bezig && (
          <div className="space-y-1" data-testid="update-voortgang">
            <p className="text-sm text-muted-foreground">{klaar ? t("update.dialoog.installeren") : t("update.dialoog.bezig")}</p>
            {voortgang?.totaal ? <Progress value={Math.min(100, Math.round((voortgang.gedaan / voortgang.totaal) * 100))} aria-label={t("update.dialoog.bezig")} /> : null}
          </div>
        )}
        {fout && (
          <Alert variant="destructive" data-testid="update-fout">
            <AlertDescription>{t("update.dialoog.fout")}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={bezig} data-testid="update-later" onClick={onClose}>
            {t("update.dialoog.later")}
          </AlertDialogCancel>
          <Button disabled={bezig} data-testid="update-nu" onClick={() => void bijwerken()}>
            {t("update.dialoog.nu")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { startInfo, type Project, type StartInfo } from "@/lib/api";
import { useSettings } from "@/components/app/settings-provider";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Bij het opstarten na een crash: "Je werk is bewaard, wil je verdergaan?". Verschijnt niet tijdens de eerste start. */
export default function HerstelMelding({ onVerder }: { onVerder: (p: Project) => void }) {
  const { t } = useTranslation();
  const { settings, geladen } = useSettings();
  const [info, setInfo] = useState<StartInfo | null>(null);
  const [gedaan, setGedaan] = useState(false);

  useEffect(() => {
    let off = false;
    void Promise.resolve(startInfo()).then(
      (i) => !off && i && setInfo(i),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, []);

  const toon = !gedaan && geladen && settings.eerste_start_klaar && !!info?.onderbroken;
  if (!toon || !info) return null;
  const p = info.laatste_project;
  return (
    <AlertDialog open onOpenChange={(o) => !o && setGedaan(true)}>
      <AlertDialogContent data-testid="herstel-melding">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("herstel.titel")}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">{p ? t("herstel.uitleg", { naam: p.naam }) : t("herstel.uitlegZonder")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="herstel-later">{t("herstel.later")}</AlertDialogCancel>
          {p && (
            <Button
              size="lg"
              data-testid="herstel-verder"
              onClick={() => {
                setGedaan(true);
                onVerder(p);
              }}
            >
              {t("herstel.verder")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

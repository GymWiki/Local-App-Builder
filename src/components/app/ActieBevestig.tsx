import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { actieConfirmAnswer } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ActieVraag {
  id: string;
  project_id: number;
  soort: string;
  params: Record<string, unknown>;
  zwaar: boolean;
}

/**
 * De bevestiging voor acties van de AI die iets buiten de computer doen (naar GitHub sturen, online zetten, naar een winkel).
 * Staat altijd in de Studio-UI, nooit in het gesprek met de AI. Sluiten telt als "Niet toestaan".
 */
export default function ActieBevestig() {
  const { t } = useTranslation();
  const [wachtrij, setWachtrij] = useState<ActieVraag[]>([]);

  useEffect(() => {
    let weg = false;
    let off: (() => void) | undefined;
    void listen<ActieVraag>("actie-confirm", (e) => setWachtrij((w) => [...w, e.payload]))
      .then((u) => (weg ? u() : (off = u)))
      .catch(() => undefined);
    return () => {
      weg = true;
      off?.();
    };
  }, []);

  const antwoord = useCallback((id: string, toestaan: boolean) => {
    setWachtrij((w) => w.filter((x) => x.id !== id));
    void actieConfirmAnswer(id, toestaan).catch(() => undefined);
  }, []);

  const q = wachtrij[0];
  if (!q) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && antwoord(q.id, false)}>
      <DialogContent className="max-w-lg" data-testid="actie-bevestig" data-soort={q.soort} aria-describedby="actie-uitleg">
        <DialogHeader>
          <DialogTitle className="text-xl">{t(`bevestig.${q.soort}.titel`)}</DialogTitle>
          <DialogDescription id="actie-uitleg" className="text-base">
            {t(`bevestig.${q.soort}.uitleg`, q.params as Record<string, string>)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => antwoord(q.id, false)} data-testid="actie-nee">
            {t("bevestig.knopNee")}
          </Button>
          <Button variant={q.zwaar ? "destructive" : "default"} onClick={() => antwoord(q.id, true)} data-testid="actie-ja">
            {t("bevestig.knopJa")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

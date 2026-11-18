import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const VOORBEELDEN = ["afspraken", "taken", "webshop", "portfolio", "kassa"] as const;

/** Beschrijf je idee in eigen woorden, of kies een voorbeeld. De AI stelt daarna maximaal drie korte vragen. */
export default function IdeeDialoog({ onStuur, onClose }: { onStuur: (idee: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [idee, setIdee] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="idee-dialoog">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("route.idee.titel")}</DialogTitle>
          <DialogDescription className="text-base">{t("route.idee.uitleg")}</DialogDescription>
        </DialogHeader>
        <Textarea value={idee} onChange={(e) => setIdee(e.target.value)} rows={4} placeholder={t("route.idee.plaats")} aria-label={t("route.idee.titel")} data-testid="idee-tekst" />
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("route.idee.of")}</p>
          <ul className="flex flex-wrap gap-2">
            {VOORBEELDEN.map((v) => (
              <li key={v}>
                <Button variant="outline" size="sm" className="h-auto whitespace-normal rounded-full py-2 text-left" data-testid={`idee-voorbeeld-${v}`} onClick={() => setIdee(t(`route.idee.voorbeeld.${v}`))}>
                  {t(`route.idee.voorbeeldNaam.${v}`)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button size="lg" disabled={idee.trim().length < 5} data-testid="idee-stuur" onClick={() => onStuur(idee.trim())}>
            {t("route.idee.stuur")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

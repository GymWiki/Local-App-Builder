import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";
import { maakProbleemrapport } from "@/lib/api";
import { anonimiseer } from "@/lib/fouten";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** "Meld een probleem": maakt een rapport zonder geheimen dat je kunt kopiëren. Er wordt niets automatisch verstuurd. */
export default function ProbleemRapport({ projectId, onClose }: { projectId?: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [tekst, setTekst] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState(false);

  async function maak() {
    setBezig(true);
    setFout(false);
    try {
      setTekst(anonimiseer(await maakProbleemrapport(projectId)));
    } catch {
      setFout(true);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="rapport-dialoog">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("rapport.titel")}</DialogTitle>
          <DialogDescription className="text-base">{t("rapport.uitleg")}</DialogDescription>
        </DialogHeader>
        {tekst && (
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap" data-testid="rapport-tekst">
            {tekst}
          </pre>
        )}
        {fout && (
          <Alert variant="destructive">
            <AlertDescription>{t("rapport.fout")}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("rapport.sluit")}
          </Button>
          {tekst ? (
            <Button size="lg" data-testid="rapport-kopieer" onClick={() => void navigator.clipboard?.writeText(tekst).then(() => toast.success(t("rapport.gekopieerd")), () => undefined)}>
              <CopyIcon aria-hidden="true" />
              {t("rapport.kopieer")}
            </Button>
          ) : (
            <Button size="lg" data-testid="rapport-maak" disabled={bezig} onClick={() => void maak()}>
              {bezig ? t("rapport.bezig") : t("rapport.maak")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

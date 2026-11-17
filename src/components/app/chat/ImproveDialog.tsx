import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { improvePrompt } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  projectId: number;
  /** De tekst die de gebruiker zelf typte. */
  original: string;
  onSend: (text: string) => void;
  onUse: (text: string) => void;
  onClose: () => void;
}

/** Toont een voorstel van de AI voor een duidelijkere opdracht. Er wordt nooit iets verstuurd zonder dat de gebruiker op ‘Versturen’ drukt. */
export default function ImproveDialog({ projectId, original, onSend, onUse, onClose }: Props) {
  const { t } = useTranslation();
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    setProposal(null);
    setError(null);
    improvePrompt(projectId, original)
      .then((p) => !off && setProposal(p))
      .catch((e) => !off && setError(String(e)));
    return () => {
      off = true;
    };
  }, [projectId, original, attempt]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("chat.verbeter.titel")}</DialogTitle>
          <DialogDescription>{t("chat.verbeter.uitleg")}</DialogDescription>
        </DialogHeader>
        {proposal === null && !error && (
          <div role="status" className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <span className="sr-only">{t("chat.verbeter.bezig")}</span>
            <p className="text-base text-muted-foreground">{t("chat.verbeter.bezig")}</p>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {proposal !== null && (
          <div className="space-y-2">
            <label htmlFor="voorstel" className="text-base font-medium">
              {t("chat.verbeter.label")}
            </label>
            <Textarea id="voorstel" value={proposal} onChange={(e) => setProposal(e.target.value)} rows={12} className="text-base" />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("chat.verbeter.annuleer")}
          </Button>
          {error && (
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {t("chat.verbeter.opnieuw")}
            </Button>
          )}
          {proposal !== null && (
            <>
              <Button variant="outline" disabled={!proposal.trim()} onClick={() => onUse(proposal)}>
                {t("chat.verbeter.gebruik")}
              </Button>
              <Button disabled={!proposal.trim()} onClick={() => onSend(proposal)}>
                {t("chat.verbeter.versturen")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

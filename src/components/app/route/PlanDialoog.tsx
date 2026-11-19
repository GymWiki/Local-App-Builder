import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectFileRead } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  projectId: number;
  onGoedkeuren: () => void;
  onAanpassen: (wens: string) => void;
  onMaakPlan: () => void;
  onClose: () => void;
}

/** Het plan in mensentaal (uit PROJECT.md) met de vraag "Klopt dit?". Geen code, geen technische termen. */
export default function PlanDialoog({ projectId, onGoedkeuren, onAanpassen, onMaakPlan, onClose }: Props) {
  const { t } = useTranslation();
  const [tekst, setTekst] = useState<string | null>(null);
  const [wens, setWens] = useState("");
  const [aanpassen, setAanpassen] = useState(false);

  useEffect(() => {
    let off = false;
    void Promise.resolve(projectFileRead(projectId, "PROJECT.md")).then(
      (r) => !off && setTekst(r?.tekst ?? ""),
      () => !off && setTekst(""),
    );
    return () => {
      off = true;
    };
  }, [projectId]);

  // Een leeg of nog niet ingevuld plan: alleen de lege koppen (regels die met # beginnen) of niets.
  const inhoud = (tekst ?? "")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .join("\n")
    .trim();
  const heeftPlan = inhoud.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="plan-dialoog">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("route.plan.titel")}</DialogTitle>
          <DialogDescription className="text-base">{heeftPlan ? t("route.plan.uitleg") : t("route.plan.leeg")}</DialogDescription>
        </DialogHeader>
        {tekst === null ? (
          <p className="text-base text-muted-foreground">{t("route.plan.laden")}</p>
        ) : heeftPlan ? (
          <div className="max-h-72 overflow-auto rounded-md bg-muted p-4 text-base whitespace-pre-wrap" data-testid="plan-tekst">
            {tekst}
          </div>
        ) : null}
        {aanpassen && (
          <div className="space-y-2">
            <Textarea value={wens} onChange={(e) => setWens(e.target.value)} rows={3} placeholder={t("route.plan.wensPlaats")} aria-label={t("route.plan.wens")} data-testid="plan-wens" />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          {!heeftPlan ? (
            <Button size="lg" data-testid="plan-maak" onClick={onMaakPlan}>
              {t("route.plan.maak")}
            </Button>
          ) : aanpassen ? (
            <>
              <Button variant="outline" onClick={() => setAanpassen(false)}>
                {t("route.plan.terug")}
              </Button>
              <Button size="lg" disabled={!wens.trim()} data-testid="plan-stuur" onClick={() => onAanpassen(wens.trim())}>
                {t("route.plan.stuur")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" data-testid="plan-aanpassen" onClick={() => setAanpassen(true)}>
                {t("route.plan.aanpassen")}
              </Button>
              <Button size="lg" data-testid="plan-klopt" onClick={onGoedkeuren}>
                {t("route.plan.klopt")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

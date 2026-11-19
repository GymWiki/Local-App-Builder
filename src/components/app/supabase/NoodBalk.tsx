import { useTranslation } from "react-i18next";
import { OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { supaEmergency, supaSetLevel } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { tijdTekst, useSupa } from "./use-supa";

/** Een rode balk bovenin de werkruimte zolang "Volledige controle" aan staat, met de noodknop en een knop om terug te gaan. */
export default function NoodBalk({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { state, ververs } = useSupa(projectId);
  if (!state.gekoppeld || state.niveau !== "volledig") return null;
  return (
    <div role="alert" data-testid="nood-balk" className="flex flex-wrap items-center gap-3 bg-destructive px-4 py-2 text-destructive-foreground">
      <TriangleAlertIcon className="size-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-base font-semibold">{t("gegevens.niveau.balk.tekst", { tijd: tijdTekst(state.volledig_resterend ?? 0) })}</p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          void supaSetLevel(projectId, "zelfstandig")
            .catch(() => undefined)
            .then(ververs)
        }
      >
        {t("gegevens.niveau.balk.terug")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        data-testid="nood-balk-stop"
        onClick={() =>
          void supaEmergency(projectId)
            .catch(() => undefined)
            .then(ververs)
        }
      >
        <OctagonXIcon aria-hidden="true" />
        {t("gegevens.niveau.noodknop")}
      </Button>
    </div>
  );
}

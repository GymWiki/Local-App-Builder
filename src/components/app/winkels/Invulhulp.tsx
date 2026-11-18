import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CopyIcon, TriangleAlertIcon } from "lucide-react";
import type { WinkelKaart } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Antwoordkaarten voor de formulieren die je zelf bij de winkel invult, met een voorstel en de reden. Geen juridisch advies. */
export default function Invulhulp({ kaarten }: { kaarten: WinkelKaart[] }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 rounded-xl border-2 border-border p-4" data-testid="winkels-invulhulp" aria-labelledby="winkels-invul-titel">
      <h3 id="winkels-invul-titel" className="text-lg font-semibold">
        {t("winkels.invul.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("winkels.invul.uitleg")}</p>
      <Alert className="border-warning/50 bg-warning/10" data-testid="invul-verantwoordelijk">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertDescription className="text-base text-foreground">{t("winkels.invul.verantwoordelijk")}</AlertDescription>
      </Alert>
      <ul className="space-y-3">
        {kaarten.map((k) => {
          const antwoord = t(`winkels.invul.antwoord.${k.antwoord}`);
          return (
            <li key={k.id} data-kaart={k.id} data-antwoord={k.antwoord} className="space-y-1 rounded-lg bg-muted/50 p-3">
              <p className="font-medium">{t(`winkels.invul.kaart.${k.id}.titel`)}</p>
              <p className="text-base">{t(`winkels.invul.kaart.${k.id}.vraag`)}</p>
              <p className="text-base">
                {t("winkels.invul.studioDenkt")}: <span className="font-semibold">{antwoord}</span>
              </p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {k.redenen.map((r) => {
                  const [soort, onderwerp] = r.split(":");
                  return <li key={r}>{onderwerp ? t(`winkels.invul.reden.${soort}`, { onderwerp: t(`winkels.invul.onderwerp.${onderwerp}`, { defaultValue: onderwerp }) }) : t(`winkels.invul.reden.${soort}`, { defaultValue: soort })}</li>;
                })}
              </ul>
              <p className="text-sm text-muted-foreground">
                {t("winkels.invul.voor")}: {k.winkels.map((w) => t(`winkels.winkel.${w}`)).join(", ")}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(antwoord).then(() => toast.success(t("winkels.gekopieerd")), () => undefined)}>
                <CopyIcon aria-hidden="true" />
                {t("winkels.kopieer")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

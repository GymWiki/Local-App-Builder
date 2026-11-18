import { useTranslation } from "react-i18next";
import { ExternalLinkIcon } from "lucide-react";
import { connectOpen, type WinkelOverzicht } from "@/lib/api";
import { Button } from "@/components/ui/button";

const STAPPEN = ["account", "app", "teksten", "afbeeldingen", "privacy", "formulieren", "bouwen", "uploaden", "beoordeling"] as const;
const ADRES: Record<"play" | "appstore", string> = { play: "https://play.google.com/console", appstore: "https://appstoreconnect.apple.com" };

/** Per winkel: wat heb je nodig, wat kost het en wat doet Studio voor je of moet je zelf doen. Eerlijk over wat nog niet automatisch gaat. */
export default function WatJeNodig({ nodig }: { nodig: WinkelOverzicht["nodig"] }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4" data-testid="winkels-nodig" aria-labelledby="winkels-nodig-titel">
      <h3 id="winkels-nodig-titel" className="text-lg font-semibold">
        {t("winkels.nodig.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("winkels.nodig.uitleg")}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(["play", "appstore"] as const).map((w) => (
          <div key={w} className="space-y-3 rounded-xl border-2 border-border p-4" data-winkel={w}>
            <h4 className="text-base font-semibold">{t(`winkels.winkel.${w}`)}</h4>
            <p className="text-base" data-testid={`kosten-${w}`}>
              {t("winkels.nodig.kosten")}: {nodig[w]?.kosten ?? ""}
              {nodig[w] && !nodig[w].geverifieerd && <span className="block text-sm text-muted-foreground">{t("winkels.nodig.kostenControleer")}</span>}
            </p>
            <p className="text-sm text-muted-foreground">{t(`winkels.nodig.wacht.${w}`)}</p>
            <ol className="space-y-2">
              {STAPPEN.map((s) => (
                <li key={s} data-stap={s} data-wie={t(`winkels.nodig.wie.${w}.${s}.wie`, { defaultValue: "zelf" })} className="text-base">
                  <span className="font-medium">{t(`winkels.nodig.stap.${s}`)}</span>
                  <span className="block text-sm text-muted-foreground">
                    <span className="font-medium">{t(`winkels.nodig.wie.${w}.${s}.wie`, { defaultValue: t("winkels.nodig.wie.zelf") })}</span> — {t(`winkels.nodig.wie.${w}.${s}.uitleg`, { defaultValue: "" })}
                  </span>
                </li>
              ))}
            </ol>
            <Button variant="outline" size="sm" onClick={() => void connectOpen(ADRES[w]).catch(() => undefined)}>
              <ExternalLinkIcon aria-hidden="true" />
              {t("winkels.nodig.open", { winkel: t(`winkels.winkel.${w}`) })}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

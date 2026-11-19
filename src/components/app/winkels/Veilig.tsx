import { useTranslation } from "react-i18next";
import { CheckIcon, CircleAlertIcon, CircleXIcon } from "lucide-react";
import type { WinkelBevinding } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** Controle op inhoud die een beoordeling kan laten mislukken. Links worden alleen op uiterlijk gecontroleerd. */
export default function Veilig({ bevindingen, onVraagAi }: { bevindingen: WinkelBevinding[]; onVraagAi?: (prompt: string) => void }) {
  const { t } = useTranslation();
  const lijst = bevindingen.map((b) => `${t(`winkels.veilig.${b.code}.titel`, { defaultValue: b.code })}${b.detail ? ` (${b.detail})` : ""}`).join("; ");
  return (
    <section className="space-y-3 rounded-xl border-2 border-border p-4" data-testid="winkels-veilig" aria-labelledby="winkels-veilig-titel">
      <h3 id="winkels-veilig-titel" className="text-lg font-semibold">
        {t("winkels.veilig.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("winkels.veilig.uitleg")}</p>
      {bevindingen.length === 0 ? (
        <p className="flex items-center gap-2 text-base" data-testid="veilig-niets">
          <CheckIcon className="size-5 text-success" aria-hidden="true" />
          {t("winkels.veilig.niets")}
        </p>
      ) : (
        <ul className="space-y-2">
          {bevindingen.map((b, i) => (
            <li key={`${b.code}-${i}`} data-code={b.code} data-ernst={b.ernst} className="flex items-start gap-3 text-base">
              {b.ernst === "fout" ? <CircleXIcon className="mt-0.5 size-5 text-destructive" aria-label={t("winkels.veilig.fout")} /> : <CircleAlertIcon className="mt-0.5 size-5 text-warning" aria-label={t("winkels.veilig.letOp")} />}
              <span>
                <span className="font-medium">{t(`winkels.veilig.${b.code}.titel`, { defaultValue: b.code })}</span>
                {b.detail && <span className="font-mono text-sm"> {b.detail.replace(/:/g, " · ")}</span>}
                <span className="block text-sm text-muted-foreground">{t(`winkels.veilig.${b.code}.uitleg`, { defaultValue: "" })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t("winkels.veilig.linksOpmerking")}</p>
      {bevindingen.length > 0 && onVraagAi && <HerstelKnop lijst={lijst} onVraagAi={onVraagAi} />}
    </section>
  );
}

function HerstelKnop({ lijst, onVraagAi }: { lijst: string; onVraagAi: (p: string) => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" data-testid="veilig-herstel" onClick={() => onVraagAi(t("winkels.veilig.prompt", { lijst }))}>
      {t("winkels.veilig.herstel")}
    </Button>
  );
}

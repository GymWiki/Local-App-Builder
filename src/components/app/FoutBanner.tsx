import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon } from "lucide-react";
import { vertaalFout } from "@/lib/fouten";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Een foutmelding in gewone taal met een oorzaak en een oplossing. De technische tekst staat achter "Toon details". */
export default function FoutBanner({ fout, onSluit, inline = false }: { fout: string; onSluit: () => void; inline?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const v = vertaalFout(fout);
  // Meldingen die al in gewone taal zijn (geen bekende technische foutcode) blijven zoals ze zijn; de tekst zelf is dan de uitleg.
  const bekend = v.code !== "onbekend";
  return (
    <Alert variant="destructive" className={inline ? "bg-destructive/10" : "rounded-none border-0 border-b border-destructive/50 bg-destructive/10"} data-testid="fout-banner" data-code={v.code}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertDescription className="space-y-1 text-base text-foreground">
        <div className="flex items-start justify-between gap-3">
          <div role="alert" className="min-w-0 space-y-1 break-words">
            {v.mensentaal ? (
              <p className="font-semibold" data-testid="fout-mensentaal">
                {fout.trim()}
              </p>
            ) : bekend ? (
              <>
                <p className="font-semibold">{t(`fouten.${v.code}.titel`)}</p>
                <p>{t(`fouten.${v.code}.oplossing`)}</p>
              </>
            ) : (
              <>
                <p className="font-semibold">{t("fouten.onbekend.titel")}</p>
                <p>{t("fouten.onbekend.oplossing")}</p>
              </>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={onSluit}>
            {t("fout.sluit")}
          </Button>
        </div>
        {!v.mensentaal && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" data-testid="fout-details-knop">
              {open ? t("fouten.verberg") : t("fouten.toonDetails")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-sm text-muted-foreground">{t("fouten.detailsUitleg")}</p>
            <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap" data-testid="fout-details">{fout}</pre>
          </CollapsibleContent>
        </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}

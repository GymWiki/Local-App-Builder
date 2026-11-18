import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Na zoveel berichten stellen we een frisse start voor. */
export const LANG_GESPREK = 60;

/** Het aantal berichten sinds de laatste scheiding (nieuwe sessie of wissel van AI). */
export function berichtenSindsScheiding(kinds: string[]): number {
  const i = kinds.lastIndexOf("divider");
  return kinds.slice(i + 1).filter((k) => k === "user" || k === "assistant" || k === "action").length;
}

/** Vriendelijke suggestie bij een lang gesprek. De gebruiker kiest zelf. */
export default function LangGesprek({ onFris, onBlijf }: { onFris: () => void; onBlijf: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert data-testid="lang-gesprek" className="space-y-2 border border-primary/40 bg-primary/5 p-4">
      <AlertTitle className="text-base font-semibold">{t("chat.lang.titel")}</AlertTitle>
      <AlertDescription className="space-y-3 text-base text-foreground">
        <p>{t("chat.lang.uitleg")}</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onFris}>{t("chat.lang.fris")}</Button>
          <Button variant="outline" onClick={onBlijf}>
            {t("chat.lang.blijf")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

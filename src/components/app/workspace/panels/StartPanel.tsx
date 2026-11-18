import { useTranslation } from "react-i18next";
import { CheckIcon, CircleIcon } from "lucide-react";
import { stappen, volgendeStap, type StapId } from "@/lib/menu";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

/** De stappenlijst van "idee" tot "online" met één grote knop voor de volgende stap. */
export default function StartPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const lijst = stappen(w.signalen);
  const volgende = volgendeStap(w.signalen);

  function ga(stap: StapId) {
    if (stap === "idee" || stap === "aanpassen") w.focusGesprek();
    else if (stap === "voorbeeld") w.openPaneel("preview");
    else w.openPaneel("onlinezetten");
  }

  return (
    <Frame titel={t("start.titel")} uitleg={t("start.uitleg")}>
      <ol className="space-y-3" data-testid="stappen">
        {lijst.map((s) => (
          <li key={s.id} data-stap={s.id} data-klaar={s.klaar ? "ja" : "nee"} className={`flex gap-3 rounded-xl border p-4 ${volgende === s.id ? "border-primary bg-accent/40" : "border-border"}`}>
            <span className={`mt-0.5 ${s.klaar ? "text-success" : "text-muted-foreground"}`}>
              {s.klaar ? <CheckIcon aria-hidden="true" className="size-5" /> : <CircleIcon aria-hidden="true" className="size-5" />}
              <span className="sr-only">{s.klaar ? t("start.stapKlaar") : t("start.stapOpen")}</span>
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold">{t(`start.stap.${s.id}.titel`)}</h3>
              <p className="text-base text-muted-foreground">{t(`start.stap.${s.id}.uitleg`)}</p>
            </div>
          </li>
        ))}
      </ol>
      {volgende === "klaar" ? (
        <div role="status" className="space-y-1 rounded-xl border border-success/40 bg-success/10 p-4">
          <h3 className="text-lg font-semibold">{t("start.klaarTitel")}</h3>
          <p className="text-base">{t("start.klaarUitleg")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Button size="lg" className="h-auto min-h-14 w-full whitespace-normal py-3 text-center" data-testid="volgende-stap" onClick={() => ga(volgende)}>
            {t("start.volgende")}: {t(`start.knop.${volgende}`)}
          </Button>
          <p className="text-base text-muted-foreground">{t(`start.hint.${volgende}`)}</p>
        </div>
      )}
    </Frame>
  );
}

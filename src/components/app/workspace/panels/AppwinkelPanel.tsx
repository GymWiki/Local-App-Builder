import { useTranslation } from "react-i18next";
import { chatSend, winkelsBewaar, type WinkelAppData } from "@/lib/api";
import Gegevens from "@/components/app/winkels/Gegevens";
import Invulhulp from "@/components/app/winkels/Invulhulp";
import KlaarCheck from "@/components/app/winkels/KlaarCheck";
import Teksten from "@/components/app/winkels/Teksten";
import Veilig from "@/components/app/winkels/Veilig";
import WatJeNodig from "@/components/app/winkels/WatJeNodig";
import { useWinkels } from "@/components/app/winkels/use-winkels";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

/**
 * In de appwinkel: gegevens van je app, klaar-check per winkel (Google Play en App Store), hulp bij de formulieren en het Winkelpakket (teksten).
 * Studio zegt eerlijk wat het zelf doet en wat jij bij de winkel moet doen. Alles met je eigen ontwikkelaarsaccounts.
 */
export default function AppwinkelPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const { overzicht, ververs } = useWinkels(w.project.id, w.tick);
  const vraagAi = (prompt: string) => void chatSend(w.project.id, prompt).then(() => w.focusGesprek()).catch(() => undefined);
  const wijzig = (d: WinkelAppData) => void winkelsBewaar(w.project.id, d).then(ververs);

  return (
    <Frame titel={t("appwinkel.titel")} badge={t("appwinkel.badge")} uitleg={t("appwinkel.uitleg")}>
      {overzicht && (
        <Tabs defaultValue="overzicht" data-testid="appwinkel-tabs">
          <TabsList className="h-auto w-full flex-wrap justify-start" aria-label={t("appwinkel.titel")}>
            <TabsTrigger value="overzicht" className="h-10">
              {t("winkels.tab.overzicht")}
            </TabsTrigger>
            <TabsTrigger value="pakket" className="h-10">
              {t("winkels.tab.pakket")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overzicht" className="space-y-5 pt-4">
            <WatJeNodig nodig={overzicht.nodig} />
            <Gegevens key={JSON.stringify(overzicht.data)} projectId={w.project.id} overzicht={overzicht} onBewaard={() => void ververs()} />
            <div className="grid gap-4 lg:grid-cols-2">
              {overzicht.winkels.map((s) => (
                <KlaarCheck key={s.winkel} stand={s} data={overzicht.data} onWijzig={wijzig} />
              ))}
            </div>
            <Invulhulp kaarten={overzicht.invulhulp.kaarten} />
            <Veilig bevindingen={overzicht.veilig} onVraagAi={vraagAi} />
            <p className="text-sm text-muted-foreground" data-testid="winkels-spec-info">
              {t("winkels.specInfo", { datum: overzicht.spec.datum })}
            </p>
          </TabsContent>
          <TabsContent value="pakket" className="space-y-5 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t("winkels.pakket.nu")}</Badge>
              <span className="text-sm text-muted-foreground">{t("winkels.pakket.nogNiet")}</span>
            </div>
            <Teksten projectId={w.project.id} talen={overzicht.data.talen} onVraagAi={vraagAi} onGewijzigd={() => void ververs()} tick={w.tick} />
          </TabsContent>
        </Tabs>
      )}
    </Frame>
  );
}

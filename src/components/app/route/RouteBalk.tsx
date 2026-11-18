import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, CircleIcon, MinusIcon, SkipForwardIcon } from "lucide-react";
import { chatSend, type ProjectFlagKey } from "@/lib/api";
import type { RouteStapId } from "@/lib/route";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "../workspace/workspace-context";
import IdeeDialoog from "./IdeeDialoog";
import PlanDialoog from "./PlanDialoog";
import { useRoute } from "./use-route";

/**
 * De voortgangsbalk bovenin het project: acht stappen van idee tot app, met één grote knop voor de volgende stap, een korte uitleg en een geschatte duur.
 * De route is een hulpmiddel: elke stap is over te slaan en je kunt altijd zelf rondklikken.
 */
export default function RouteBalk() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const { route, geladen, ververs } = useRoute(w.project.id, w.tick);
  const [dialoog, setDialoog] = useState<null | "idee" | "plan">(null);

  if (!geladen) return null;

  async function stuur(prompt: string, melding?: string) {
    try {
      await chatSend(w.project.id, prompt);
      if (melding) toast.success(melding);
      w.focusGesprek();
    } catch (e) {
      w.onError(t("fout.algemeen", { bericht: String(e) }));
    }
    void ververs();
  }

  const zetVlag = async (k: ProjectFlagKey, v: string | null) => {
    await w.setVlag(k, v);
    void ververs();
  };

  function ga(id: RouteStapId) {
    switch (id) {
      case "idee":
        return setDialoog("idee");
      case "plan":
        return setDialoog("plan");
      case "uiterlijk":
        return w.openPaneel("uiterlijk");
      case "bouwen":
        return void stuur(t("route.prompt.bouwen"), t("route.verstuurd"));
      case "aanpassen":
        return w.focusGesprek();
      case "gegevens":
        void w.setVlag("gegevens_aan", "1");
        return w.openPaneel("gegevens");
      case "testen":
        return void stuur(t("route.prompt.testen"), t("route.verstuurd"));
      case "delen":
        return w.openPaneel("onlinezetten");
    }
  }

  const huidig = route.huidig;
  const stap = route.stappen.find((s) => s.id === huidig);
  return (
    <div className="border-b border-border bg-card px-4 py-2" data-testid="route-balk" data-huidig={huidig} role="region" aria-label={t("route.titel")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ol className="flex items-center gap-1" aria-label={t("route.stappen")}>
          {route.stappen.map((s, i) => {
            const label = t(`route.stap.${s.id}.titel`);
            const status = s.klaar ? "klaar" : s.overgeslagen ? "overgeslagen" : s.huidig ? "huidig" : "open";
            return (
              <li key={s.id} data-stap={s.id} data-status={status}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={s.huidig ? "default" : "ghost"} size="sm" className="h-9 min-w-9 gap-1 px-2" aria-label={`${t("route.stapNummer", { nummer: i + 1 })}: ${label} (${t(`route.status.${status}`)})`} aria-current={s.huidig ? "step" : undefined} onClick={() => ga(s.id)}>
                      {s.klaar ? <CheckIcon className="size-4 text-success" aria-hidden="true" /> : s.overgeslagen ? <MinusIcon className="size-4" aria-hidden="true" /> : s.huidig ? <span className="text-sm font-semibold">{i + 1}</span> : <CircleIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                      {s.huidig && <span className="hidden text-sm xl:inline">{label}</span>}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{`${i + 1}. ${label}${s.nvt ? ` · ${t("route.nvt")}` : ""}`}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ol>
        {stap ? (
          <>
            <p className="min-w-0 flex-1 text-sm" data-testid="route-uitleg">
              <span className="font-semibold">{t("route.stapVan", { nummer: route.nummer, totaal: route.totaal })}: {t(`route.stap.${stap.id}.titel`)}.</span>{" "}
              <span className="text-muted-foreground">
                {t(`route.stap.${stap.id}.uitleg`)} ({t(`route.stap.${stap.id}.duur`)})
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" data-testid="route-overslaan" onClick={() => void zetVlag(`over_${stap.id}` as ProjectFlagKey, "1")}>
                <SkipForwardIcon aria-hidden="true" />
                {t("route.overslaan")}
              </Button>
              <Button size="lg" data-testid="route-volgende" onClick={() => ga(stap.id)}>
                {t(`route.stap.${stap.id}.knop`)}
              </Button>
            </div>
          </>
        ) : (
          <p className="flex-1 text-sm font-medium text-success" data-testid="route-klaar">
            {t("route.klaar")}
          </p>
        )}
      </div>
      {dialoog === "idee" && (
        <IdeeDialoog
          onClose={() => setDialoog(null)}
          onStuur={(idee) => {
            setDialoog(null);
            void stuur(t("route.prompt.idee", { idee }), t("route.verstuurd"));
          }}
        />
      )}
      {dialoog === "plan" && (
        <PlanDialoog
          projectId={w.project.id}
          onClose={() => setDialoog(null)}
          onGoedkeuren={() => {
            setDialoog(null);
            void zetVlag("route_plan", "1");
            toast.success(t("route.plan.goedgekeurd"));
          }}
          onAanpassen={(wens) => {
            setDialoog(null);
            void stuur(t("route.prompt.planAanpassen", { wens }), t("route.verstuurd"));
          }}
          onMaakPlan={() => {
            setDialoog(null);
            void stuur(t("route.prompt.maakPlan"), t("route.verstuurd"));
          }}
        />
      )}
    </div>
  );
}

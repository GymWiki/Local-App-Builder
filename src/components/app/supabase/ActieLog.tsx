import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { supaActions, supaUndo, type SupaAction } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { wijzigingTekst } from "./BevestigDialoog";

const TOON: Record<string, string> = {
  uitgevoerd: "border-transparent bg-success/15 text-success",
  geweigerd: "border-transparent bg-muted text-muted-foreground",
  mislukt: "border-transparent bg-destructive/15 text-destructive",
  afgebroken: "border-transparent bg-warning/20 text-warning",
};

/** "Wat heeft de AI gedaan?": het actielog in gewone woorden, met "Maak ongedaan" waar dat kan en een eerlijke melding waar het niet kan. */
export default function ActieLog({ projectId, tick }: { projectId: number; tick: number }) {
  const { t } = useTranslation();
  const [lijst, setLijst] = useState<SupaAction[] | null>(null);

  useEffect(() => {
    let weg = false;
    void Promise.resolve(supaActions(projectId))
.then((l) => !weg && setLijst(Array.isArray(l) ? l : []))
      .catch(() => !weg && setLijst([]));
    return () => {
      weg = true;
    };
  }, [projectId, tick]);

  const ongedaan = async (a: SupaAction) => {
    try {
      const r = await supaUndo(projectId, a.id);
      if (r.status === "uitgevoerd") toast.success(t("gegevens.log.ongedaanKlaar"));
      else toast.error(r.tekst);
      setLijst(await supaActions(projectId));
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <section className="space-y-2" data-testid="actie-log">
      <h3 className="text-lg font-semibold">{t("gegevens.log.titel")}</h3>
      <p className="text-base text-muted-foreground">{t("gegevens.log.uitleg")}</p>
      {lijst && lijst.length === 0 && <p className="text-base">{t("gegevens.log.leeg")}</p>}
      <ol className="space-y-2">
        {(lijst ?? []).map((a) => {
          const beschrijving = (a.summary ?? []).map((c) => wijzigingTekst(t, c)).join("; ") || a.tool;
          return (
            <li key={a.id} data-testid="actie" className="space-y-1 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={TOON[a.status] ?? TOON.geweigerd}>{t(`gegevens.log.status.${a.status}`, { defaultValue: a.status })}</Badge>
                <Badge variant="outline">{t(`gegevens.log.klasse.${a.class}`, { defaultValue: "" })}</Badge>
                <time className="text-sm text-muted-foreground" dateTime={new Date(a.at * 1000).toISOString()}>
                  {new Date(a.at * 1000).toLocaleString("nl-NL")}
                </time>
                <span className="text-sm text-muted-foreground">{t("gegevens.log.niveauBij", { niveau: t(`gegevens.niveau.${a.level}.naam`, { defaultValue: a.level }) })}</span>
              </div>
              <p className="text-base">{beschrijving}</p>
              {a.status !== "uitgevoerd" && a.detail?.code && <p className="text-sm text-muted-foreground">{t(`gegevens.log.redenen.${a.detail.code}`, { defaultValue: "" })}</p>}
              {a.detail?.backup === "gemaakt" && <p className="text-sm text-muted-foreground">{t("gegevens.log.backup")}</p>}
              {a.undone ? (
                <p className="text-sm text-muted-foreground">{t("gegevens.log.isOngedaan")}</p>
              ) : a.kan_ongedaan ? (
                <Button variant="outline" size="sm" onClick={() => void ongedaan(a)} data-testid="ongedaan">
                  <Undo2Icon aria-hidden="true" />
                  {t("gegevens.log.ongedaan")}
                </Button>
              ) : (
                a.status === "uitgevoerd" && a.class >= 2 && <p className="text-sm text-muted-foreground">{t("gegevens.log.nietOngedaan")}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

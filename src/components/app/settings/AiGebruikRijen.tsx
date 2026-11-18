import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { kaartContext, kaartTekst, kaartVernieuw, type ContextItem, type KaartStatus, type Project } from "@/lib/api";
import { defaults } from "@/lib/settings";
import { useSettings } from "@/components/app/settings-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Keuze from "./Keuze";
import Rij from "./Rij";

const BELEIDEN = ["auto", "zuinig", "gebalanceerd", "best"] as const;

/** "Hoeveel mag de AI nadenken?" (voor alle projecten). Technische modelnamen staan alleen onder "Voor gevorderden". */
export function BeleidRij() {
  const { t } = useTranslation();
  const { settings: s, set, reset } = useSettings();
  const d = defaults();
  return (
    <Rij id="inst-beleid" label={t("inst.ai.beleid.label")} uitleg={t("inst.ai.beleid.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("model_beleid"), isStandaard: s.model_beleid === d.model_beleid }}>
      <Keuze
        naam="beleid"
        label={t("inst.ai.beleid.label")}
        waarde={s.model_beleid}
        onChange={(v) => void set("model_beleid", v)}
        opties={BELEIDEN.map((v) => ({ value: v, titel: t(`inst.ai.beleid.${v}`), tekst: t(`inst.ai.beleid.${v}Uitleg`) }))}
      />
    </Rij>
  );
}

/** Onder "Voor gevorderden": eigen modelnaam, projectkaart en "Wat gaat er naar de AI?". */
export function AiGebruikGevorderd({ project }: { project: Project | null }) {
  const { t } = useTranslation();
  const { settings: s, set, reset } = useSettings();
  const d = defaults();
  const [eigen, setEigen] = useState(s.model_eigen);
  const [status, setStatus] = useState<KaartStatus | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState(false);
  const [tekst, setTekst] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ContextItem[]>([]);
  const projectId = project?.id;

  useEffect(() => {
    if (projectId == null) return;
    let off = false;
    void Promise.resolve(kaartContext(projectId)).then(
      (c) => !off && setCtx(Array.isArray(c) ? c : []),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [projectId, status]);

  async function vernieuw() {
    if (projectId == null) return;
    setBezig(true);
    setFout(false);
    try {
      setStatus(await kaartVernieuw(projectId));
    } catch {
      setFout(true);
    } finally {
      setBezig(false);
    }
  }

  async function bekijk() {
    if (projectId == null) return;
    try {
      setTekst(await kaartTekst(projectId));
    } catch {
      setFout(true);
    }
  }

  return (
    <>
      <Rij id="inst-model" label={t("inst.gevorderd.model.label")} uitleg={t("inst.gevorderd.model.uitleg")} bereik="alle" herstel={{ onReset: () => { setEigen(""); void reset("model_eigen"); }, isStandaard: s.model_eigen === d.model_eigen }}>
        <div className="flex flex-wrap items-center gap-3">
          <Input value={eigen} onChange={(e) => setEigen(e.target.value)} placeholder={t("inst.gevorderd.model.placeholder")} aria-label={t("inst.gevorderd.model.label")} className="max-w-xs" maxLength={60} />
          <Button variant="outline" disabled={eigen === s.model_eigen} onClick={() => void set("model_eigen", eigen.trim())}>
            {t("inst.gevorderd.model.opslaan")}
          </Button>
        </div>
      </Rij>
      <Rij id="inst-kaart" label={t("inst.gevorderd.kaart.label")} uitleg={t("inst.gevorderd.kaart.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("kaart_aan"), isStandaard: s.kaart_aan === d.kaart_aan }}>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={s.kaart_aan} onCheckedChange={(v) => void set("kaart_aan", v)} aria-label={t("inst.gevorderd.kaart.aan")} />
            <span className="text-base">{t("inst.gevorderd.kaart.aan")}</span>
          </div>
          {!s.kaart_aan && <p className="text-sm text-muted-foreground">{t("inst.gevorderd.kaart.uit")}</p>}
          {s.kaart_aan && (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={projectId == null || bezig} onClick={() => void vernieuw()} data-testid="kaart-vernieuw">
                {bezig ? t("inst.gevorderd.kaart.bezig") : t("inst.gevorderd.kaart.vernieuw")}
              </Button>
              <Button variant="outline" disabled={projectId == null} onClick={() => void bekijk()} data-testid="kaart-bekijk">
                {t("inst.gevorderd.kaart.bekijk")}
              </Button>
            </div>
          )}
          {projectId == null && <p className="text-sm text-muted-foreground">{t("inst.gevorderd.kaart.geenProject")}</p>}
          {status && status.aan && (
            <p className="text-base" role="status" data-testid="kaart-status">
              {t("inst.gevorderd.kaart.status", { bestanden: status.bestanden, tokens: status.tokens })}
              {status.terugval > 0 ? ` ${t("inst.gevorderd.kaart.terugval", { aantal: status.terugval })}` : ""}
            </p>
          )}
          {fout && (
            <Alert variant="destructive">
              <AlertDescription>{t("inst.gevorderd.kaart.fout")}</AlertDescription>
            </Alert>
          )}
        </div>
      </Rij>
      <Rij id="inst-context" label={t("inst.gevorderd.context.label")} uitleg={t("inst.gevorderd.context.uitleg")} bereik="dit">
        {projectId == null ? (
          <p className="text-sm text-muted-foreground">{t("inst.gevorderd.kaart.geenProject")}</p>
        ) : (
          <ul className="space-y-2 text-base" data-testid="context-lijst">
            {ctx.map((c) => (
              <li key={c.id} data-id={c.id}>
                <span className="font-medium">{t(`inst.gevorderd.context.${c.id}`)}</span>: {t("inst.gevorderd.context.tokens", { tokens: c.tokens })}
                {c.te_groot && <p className="text-sm text-warning">{t("inst.gevorderd.context.teGroot")}</p>}
              </li>
            ))}
          </ul>
        )}
      </Rij>
      <Dialog open={tekst !== null} onOpenChange={(o) => !o && setTekst(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("inst.gevorderd.kaart.label")}</DialogTitle>
            <DialogDescription>{t("inst.gevorderd.kaart.uitleg")}</DialogDescription>
          </DialogHeader>
          <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap" data-testid="kaart-tekst">
            {tekst}
          </pre>
          <Button variant="outline" onClick={() => setTekst(null)}>
            {t("inst.gevorderd.kaart.sluit")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

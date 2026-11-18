import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, CircleIcon, CopyIcon, ExternalLinkIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { connectOpen, vercelCancel, vercelDeploy, vercelDeployments, vercelRollback, type VercelUitkomst, type VercelVersie } from "@/lib/api";
import { onlineStappen, volgendeOnlineStap, type OnlineSignalen } from "@/lib/online";
import VerbindKnop from "@/components/app/connect/VerbindKnop";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { useVercel } from "./use-vercel";

interface Props {
  projectId: number;
  /// De laatste controle faalde niet en er is een opgeslagen versie.
  controlesGroen: boolean;
  tick?: number;
  onVraagAi: (prompt: string) => void;
  /// De echte site staat online (zet de vlag "Online gezet").
  onLive?: () => void;
  /// Naar het onderdeel met de omgevingsvariabelen.
  onNaarVariabelen?: () => void;
}

interface Vondst {
  code: string;
  namen?: string[];
  bestanden?: { bestand: string; regel?: number | null; soort?: string }[];
}

function Uitkomst({ u, onVraagAi }: { u: VercelUitkomst; onVraagAi: (p: string) => void }) {
  const { t } = useTranslation();
  const goed = u.status === "uitgevoerd";
  const url = typeof u.params.url === "string" ? u.params.url : null;
  const problemen = (Array.isArray(u.params.problemen) ? u.params.problemen : []) as Vondst[];
  const regels = (Array.isArray(u.params.regels) ? u.params.regels : []) as string[];
  const soort = typeof u.params.soort === "string" ? u.params.soort : null;
  const waarschuwingen = (Array.isArray(u.params.waarschuwingen) ? u.params.waarschuwingen : []) as Vondst[];
  const tekst = t(`vercel.uitkomst.${u.code}`, { defaultValue: t("vercel.uitkomst.onbekend") });
  return (
    <div className="space-y-2" data-testid="vercel-uitkomst" data-code={u.code}>
      <Alert role="status" className={goed ? "border-success/50 bg-success/10" : "border-warning/50 bg-warning/10"}>
        {goed ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
        <AlertDescription className="space-y-3 text-base text-foreground">
          <p>{tekst}</p>
          {goed && url && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm" data-testid="vercel-adres">{url}</span>
              <Button size="sm" variant="outline" data-testid="vercel-kopieer" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success(t("vercel.gekopieerd")), () => undefined)}>
                <CopyIcon aria-hidden="true" />
                {t("vercel.kopieer")}
              </Button>
              <Button size="sm" variant="outline" data-testid="vercel-open" onClick={() => void connectOpen(url).catch(() => undefined)}>
                <ExternalLinkIcon aria-hidden="true" />
                {t("vercel.openBrowser")}
              </Button>
            </div>
          )}
          {u.code === "controles" && (
            <div data-testid="vercel-problemen">
              <ul className="list-disc space-y-1 pl-5">
                {problemen.map((p) => (
                  <li key={p.code} data-code={p.code}>
                    {t(`vercel.probleem.${p.code}`, { defaultValue: p.code })}
                    {p.namen && p.namen.length > 0 && <span className="font-mono text-sm"> {p.namen.join(", ")}</span>}
                    {p.bestanden && p.bestanden.length > 0 && <span className="font-mono text-sm"> {p.bestanden.map((b) => b.bestand).join(", ")}</span>}
                  </li>
                ))}
              </ul>
              <Button className="mt-3" variant="outline" data-testid="vercel-herstel" onClick={() => onVraagAi(t("vercel.probleem.prompt", { lijst: problemen.map((p) => t(`vercel.probleem.${p.code}`, { defaultValue: p.code }) + (p.namen?.length ? ` (${p.namen.join(", ")})` : p.bestanden?.length ? ` (${p.bestanden.map((b) => b.bestand).join(", ")})` : "")).join("; ") }))}>
                {t("vercel.herstel")}
              </Button>
            </div>
          )}
          {u.code === "bouw_mislukt" && soort && (
            <div className="space-y-2" data-testid="vercel-bouwfout">
              <p className="font-medium">{t(`vercel.bouw.${soort}`, { defaultValue: t("vercel.bouw.onbekend") })}</p>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">{t("vercel.bouw.details")}</Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap" data-testid="vercel-bouwregels">{regels.join("\n")}</pre>
                </CollapsibleContent>
              </Collapsible>
              <Button variant="outline" data-testid="vercel-herstel-bouw" onClick={() => onVraagAi(t("vercel.bouw.prompt", { soort: t(`vercel.bouw.${soort}`, { defaultValue: t("vercel.bouw.onbekend") }), regels: regels.join(" | ") }))}>
                {t("vercel.herstel")}
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
      {goed && waarschuwingen.some((w) => w.code === "variabelen_ontbreken") && (
        <p className="text-sm text-muted-foreground" data-testid="vercel-waarschuwing">{t("vercel.waarschuwingVariabelen", { namen: waarschuwingen.find((w) => w.code === "variabelen_ontbreken")?.namen?.join(", ") ?? "" })}</p>
      )}
    </div>
  );
}

/**
 * Online zetten met je eigen Vercel-account: vijf stappen met bolletjes, één grote knop voor de volgende stap, een voorbeeld online zetten,
 * echt online zetten (altijd met een bevestiging) en een lijst met eerdere versies om naar terug te gaan.
 */
export default function OnlineZetten({ projectId, controlesGroen, tick = 0, onVraagAi, onLive, onNaarVariabelen }: Props) {
  const { t } = useTranslation();
  const { state, geladen, voortgang, ververs } = useVercel(projectId, tick);
  const [bezig, setBezig] = useState<"preview" | "live" | null>(null);
  const [uitkomst, setUitkomst] = useState<VercelUitkomst | null>(null);
  const [vraagLive, setVraagLive] = useState(false);
  const [versies, setVersies] = useState<VercelVersie[] | null>(null);
  const [terug, setTerug] = useState<VercelVersie | null>(null);

  const signalen: OnlineSignalen = { controlesGroen, vercelGekoppeld: state.werkt, ontbrekendeVariabelen: state.ontbrekend.length, voorbeeldOnline: !!state.voorbeeld, liveOnline: !!state.live };
  const volgende = volgendeOnlineStap(signalen);

  useEffect(() => {
    if (!state.werkt || !state.project) return;
    let off = false;
    void Promise.resolve(vercelDeployments(projectId)).then(
      (r) => !off && r?.lijst && setVersies(r.lijst),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [projectId, state.werkt, state.project, state.live?.at, tick]);

  async function zetOnline(doel: "preview" | "live") {
    setBezig(doel);
    setUitkomst(null);
    try {
      const u = await vercelDeploy(projectId, doel, doel === "live");
      setUitkomst(u);
      if (u.status === "uitgevoerd" && doel === "live") onLive?.();
    } catch (e) {
      setUitkomst({ status: "mislukt", code: "onverwacht", params: { detail: String(e) } });
    } finally {
      setBezig(null);
      void ververs();
    }
  }

  async function zetTerug(v: VercelVersie) {
    setTerug(null);
    try {
      const u = await vercelRollback(projectId, v.id, true);
      setUitkomst(u);
    } catch (e) {
      setUitkomst({ status: "mislukt", code: "onverwacht", params: { detail: String(e) } });
    } finally {
      void ververs();
    }
  }

  const werkend = bezig !== null || state.bezig;
  const kanOnline = !state.flutter;
  return (
    <section className="space-y-4 rounded-xl border-2 border-border p-4" data-testid="vercel-online" aria-labelledby="vercel-titel">
      <h3 id="vercel-titel" className="text-lg font-semibold">
        {t("vercel.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("vercel.uitleg")}</p>

      <ol className="space-y-2" data-testid="online-stappen">
        {onlineStappen(signalen).map((s) => (
          <li key={s.id} data-stap={s.id} data-klaar={s.klaar ? "ja" : "nee"} className="flex items-start gap-3 text-base">
            <span className={`mt-0.5 ${s.klaar ? "text-success" : "text-muted-foreground"}`}>{s.klaar ? <CheckIcon aria-hidden="true" className="size-5" /> : <CircleIcon aria-hidden="true" className="size-5" />}</span>
            <span>{t(`vercel.stap.${s.id}`)}</span>
          </li>
        ))}
      </ol>

      {state.flutter && (
        <Alert className="border-warning/50 bg-warning/10" data-testid="vercel-flutter">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-base text-foreground">{t("vercel.flutter")}</AlertDescription>
        </Alert>
      )}

      {geladen && kanOnline && (
        <div className="space-y-3">
          {volgende === "controles" && (
            <Button size="lg" data-testid="online-volgende" data-stap="controles" onClick={() => onVraagAi(t("vercel.controlesPrompt"))}>
              {t("vercel.volgende.controles")}
            </Button>
          )}
          {volgende === "gekoppeld" && (
            <div data-testid="online-volgende" data-stap="gekoppeld" className="space-y-2">
              <p className="text-base">{t("koppelingen.plek.onlinezetten")}</p>
              <VerbindKnop id="vercel" onConnected={() => void ververs()} />
            </div>
          )}
          {volgende === "variabelen" && (
            <Button size="lg" data-testid="online-volgende" data-stap="variabelen" onClick={() => onNaarVariabelen?.()}>
              {t("vercel.volgende.variabelen")}
            </Button>
          )}
          {volgende === "voorbeeld" && (
            <Button size="lg" data-testid="online-volgende" data-stap="voorbeeld" disabled={werkend} onClick={() => void zetOnline("preview")}>
              {t("vercel.volgende.voorbeeld")}
            </Button>
          )}
          {volgende === "live" && (
            <Button size="lg" data-testid="online-volgende" data-stap="live" disabled={werkend} onClick={() => setVraagLive(true)}>
              {t("vercel.volgende.live")}
            </Button>
          )}
          {volgende === "klaar" && <p className="text-base font-medium text-success" data-testid="online-volgende" data-stap="klaar">{t("vercel.volgende.klaar")}</p>}

          {state.werkt && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" data-testid="vercel-voorbeeld" disabled={werkend || !controlesGroen} onClick={() => void zetOnline("preview")}>
                {t("vercel.voorbeeld")}
              </Button>
              <Button variant="outline" data-testid="vercel-live" disabled={werkend || !controlesGroen} onClick={() => setVraagLive(true)}>
                {t("vercel.live")}
              </Button>
            </div>
          )}
          {werkend && (
            <div className="space-y-1" data-testid="vercel-voortgang">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
                {t(`vercel.fase.${voortgang?.stap ?? "bezig"}`, { defaultValue: t("vercel.fase.bezig") })}
              </p>
              {voortgang && voortgang.totaal > 0 && <Progress value={Math.round((voortgang.klaar / voortgang.totaal) * 100)} aria-label={t("vercel.voortgang")} />}
              <Button variant="ghost" size="sm" data-testid="vercel-stop" onClick={() => void vercelCancel(projectId)}>
                {t("vercel.stop")}
              </Button>
            </div>
          )}
        </div>
      )}

      {uitkomst && <Uitkomst u={uitkomst} onVraagAi={onVraagAi} />}

      {state.live?.url && !uitkomst && (
        <p className="text-base" data-testid="vercel-live-adres">
          {t("vercel.liveAdres")} <span className="font-mono text-sm">{state.live.url}</span>
        </p>
      )}

      {versies && versies.length > 0 && (
        <div className="space-y-2" data-testid="vercel-versies">
          <h4 className="font-medium">{t("vercel.eerder.titel")}</h4>
          <ul className="space-y-2">
            {versies.slice(0, 10).map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-base" data-doel={v.doel}>
                <span>{new Date(v.gemaakt * 1000).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-sm">{v.doel === "production" ? t("vercel.eerder.echt") : t("vercel.eerder.voorbeeld")}</span>
                <span className="text-sm text-muted-foreground">{v.status === "READY" ? t("vercel.eerder.klaar") : v.status === "ERROR" ? t("vercel.eerder.mislukt") : v.status}</span>
                {v.adres && (
                  <Button variant="ghost" size="sm" onClick={() => void connectOpen(`https://${v.adres}`).catch(() => undefined)}>
                    <ExternalLinkIcon aria-hidden="true" />
                    {t("vercel.openBrowser")}
                  </Button>
                )}
                {v.doel === "production" && v.status === "READY" && i > 0 && (
                  <Button variant="outline" size="sm" data-testid="vercel-terug" onClick={() => setTerug(v)}>
                    {t("vercel.eerder.terug")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-muted-foreground" data-testid="vercel-voorwaarden">
        {t("vercel.voorwaarden")}{" "}
        <Button variant="link" className="h-auto p-0" onClick={() => void connectOpen("https://vercel.com/pricing").catch(() => undefined)}>
          {t("vercel.voorwaardenLink")}
        </Button>
      </p>

      <AlertDialog open={vraagLive} onOpenChange={setVraagLive}>
        <AlertDialogContent data-testid="vercel-live-dialoog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("vercel.liveVraag.titel")}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-base">
              <span className="block">{t("vercel.liveVraag.uitleg", { naam: state.project ?? "" })}</span>
              <span className="block">{state.live?.url ? t("vercel.liveVraag.adresBestaand", { adres: state.live.url }) : t("vercel.liveVraag.adresNieuw")}</span>
              <span className="block">{t("vercel.liveVraag.terug")}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="vercel-live-nee">{t("vercel.liveVraag.nee")}</AlertDialogCancel>
            <AlertDialogAction data-testid="vercel-live-ja" onClick={() => void zetOnline("live")}>
              {t("vercel.liveVraag.ja")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!terug} onOpenChange={(o) => !o && setTerug(null)}>
        <AlertDialogContent data-testid="vercel-terug-dialoog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("vercel.terugVraag.titel")}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">{t("vercel.terugVraag.uitleg")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("vercel.liveVraag.nee")}</AlertDialogCancel>
            <AlertDialogAction data-testid="vercel-terug-ja" onClick={() => terug && void zetTerug(terug)}>
              {t("vercel.terugVraag.ja")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

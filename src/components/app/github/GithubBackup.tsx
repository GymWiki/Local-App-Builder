import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { CheckIcon, ExternalLinkIcon, LoaderCircleIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { connectOpen, githubBackup, githubFirstBackup, githubSetAiAsk, githubSetAuto, githubSuggestName, githubUnlink, type GhUitkomst } from "@/lib/api";
import VerbindKnop from "@/components/app/connect/VerbindKnop";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useGithub } from "./use-github";

interface Props {
  projectId: number;
  /** De gebruiker wil de AI de verschillen laten samenvoegen (we sturen een bericht naar het gesprek). */
  onVraagAi?: (prompt: string) => void;
  tick?: number;
}

/** Hoe lang geleden, in gewone woorden. */
export function tijdGeleden(t: TFunction, ts: number, nu = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, nu - ts);
  if (s < 60) return t("github.tijd.zojuist");
  if (s < 3600) return t("github.tijd.minuten", { aantal: Math.floor(s / 60) });
  if (s < 86400) return t("github.tijd.uren", { aantal: Math.floor(s / 3600) });
  return t("github.tijd.dagen", { aantal: Math.floor(s / 86400) });
}

interface Vondst {
  bestand: string;
  regel?: number | null;
  soort?: string;
  historie?: boolean;
  grootte?: number;
  waarschuwing?: string;
  aantal?: number;
}

function Vondsten({ lijst, titel }: { lijst: Vondst[]; titel?: string }) {
  const { t } = useTranslation();
  if (lijst.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="github-vondsten">
      {titel && <p className="font-medium">{titel}</p>}
      <ul className="list-disc space-y-1 pl-5">
        {lijst.map((v, i) => (
          <li key={`${v.bestand}-${v.regel ?? i}-${i}`} data-soort={v.soort ?? v.waarschuwing}>
            <span className="font-mono text-sm">{v.bestand}</span>
            {v.regel ? <span className="text-muted-foreground"> ({t("github.scan.regel", { regel: v.regel })})</span> : null}
            {" — "}
            {v.grootte ? t("github.scan.groot", { mb: Math.round(v.grootte / 1048576) }) : t(`github.scan.soort.${v.soort}`, { defaultValue: t("github.scan.soort.onbekend") })}
            {v.historie ? <span className="text-muted-foreground"> {t("github.scan.historie")}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** De vaste vraag aan de AI om gevonden geheimen of grote bestanden te herstellen (alleen bestandsnamen; nooit de waarde zelf). */
export function herstelPrompt(t: TFunction, lijst: Vondst[]): string {
  return t("github.scan.prompt", { lijst: lijst.map((v) => (v.regel ? `${v.bestand} (regel ${v.regel})` : v.bestand)).join(", ") });
}

function UitkomstMelding({ u, onVraagAi }: { u: GhUitkomst; onVraagAi?: (p: string) => void }) {
  const { t } = useTranslation();
  const goed = u.status === "uitgevoerd";
  const tekst = u.code === "back_up_klaar" ? (Number(u.params.aantal) === 1 ? t("github.uitkomst.back_up_klaar_een") : t("github.uitkomst.back_up_klaar", { aantal: Number(u.params.aantal) })) : t(`github.uitkomst.${u.code}`, { ...u.params, defaultValue: t("github.uitkomst.onbekend") });
  const bestanden = (Array.isArray(u.params.bestanden) ? u.params.bestanden : []) as Vondst[];
  const waarschuwingen = (Array.isArray(u.params.waarschuwingen) ? u.params.waarschuwingen : []) as Vondst[];
  const geheimW = waarschuwingen.filter((w) => w.waarschuwing === "geheim");
  const grootW = waarschuwingen.filter((w) => w.waarschuwing === "groot");
  const ignoreW = waarschuwingen.find((w) => w.waarschuwing === "gitignore");
  const geblokkeerd = u.code === "geheimen" || u.code === "te_groot";
  return (
    <div className="space-y-2">
      <Alert role="status" data-testid="github-uitkomst" data-code={u.code} className={goed ? "border-success/50 bg-success/10" : "border-warning/50 bg-warning/10"}>
        {goed ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
        <AlertDescription className="space-y-3 text-base text-foreground">
          <p>{tekst}</p>
          {geblokkeerd && (
            <>
              <p>{t(u.code === "geheimen" ? "github.scan.uitleg" : "github.scan.uitlegGroot")}</p>
              <Vondsten lijst={bestanden} />
              {u.params.openbaar === true && <p>{t("github.scan.openbaarStrenger")}</p>}
              {onVraagAi && (
                <Button variant="outline" data-testid="github-herstel" onClick={() => onVraagAi(herstelPrompt(t, bestanden))}>
                  {t("github.scan.herstel")}
                </Button>
              )}
            </>
          )}
        </AlertDescription>
      </Alert>
      {goed && geheimW.length > 0 && (
        <Alert className="border-warning/50 bg-warning/10" data-testid="github-historie-waarschuwing">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="space-y-2 text-base text-foreground">
            <p>{t("github.scan.historieUitleg")}</p>
            <Vondsten lijst={geheimW} />
          </AlertDescription>
        </Alert>
      )}
      {goed && grootW.length > 0 && (
        <Alert className="border-warning/50 bg-warning/10" data-testid="github-groot-waarschuwing">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="space-y-2 text-base text-foreground">
            <p>{t("github.scan.grootUitleg")}</p>
            <Vondsten lijst={grootW} />
          </AlertDescription>
        </Alert>
      )}
      {goed && ignoreW && (
        <p className="text-sm text-muted-foreground" data-testid="github-gitignore">
          {t("github.scan.gitignore", { aantal: ignoreW.aantal ?? 0 })}
        </p>
      )}
    </div>
  );
}

/**
 * De back-up op GitHub (onder Eerdere versies). Nog niet gekoppeld: de Verbinden-knop. Gekoppeld maar nog geen kopie: een
 * kleine eerste keer-kaart (privé standaard). Daarna: bijwerken, laatste back-up, automatisch en de uitleg als het uiteenloopt.
 */
export default function GithubBackup({ projectId, onVraagAi, tick = 0 }: Props) {
  const { t } = useTranslation();
  const { state, geladen, voortgang, ververs } = useGithub(projectId, tick);
  const [uitkomst, setUitkomst] = useState<GhUitkomst | null>(null);
  const [bezig, setBezig] = useState(false);
  // De Verbinden-dialoog blijft staan tot hij dicht is, ook als de koppeling intussen werkt; daarna gaat de plek door met de eerste back-up.
  const [dialoogOpen, setDialoogOpen] = useState(false);

  async function bijwerken() {
    setBezig(true);
    setUitkomst(null);
    try {
      const u = await githubBackup(projectId);
      setUitkomst(u);
      if (u.status === "uitgevoerd") toast.success(t("github.klaarMelding"));
    } catch (e) {
      setUitkomst({ status: "mislukt", code: "onverwacht", params: { detail: String(e) } });
    } finally {
      setBezig(false);
      void ververs();
    }
  }

  const link = state.link;
  return (
    <section className="mb-5 space-y-3 rounded-xl border-2 border-border p-4" data-testid="versies-koppeling" aria-labelledby="github-titel">
      <h3 id="github-titel" className="text-lg font-semibold">
        {t("github.titel")}
      </h3>
      {!geladen ? null : !state.werkt || dialoogOpen ? (
        <>
          <p className="text-base text-muted-foreground">{t("github.nietGekoppeld")}</p>
          <VerbindKnop id="github" onConnected={() => void ververs()} onDialoogGeopend={() => setDialoogOpen(true)} onDialoogGesloten={() => setDialoogOpen(false)} />
          <p className="text-sm text-muted-foreground">{t("github.privacy")}</p>
        </>
      ) : !link ? (
        <EersteKeer projectId={projectId} onKlaar={(u) => { setUitkomst(u); void ververs(); }} uitkomst={uitkomst} onVraagAi={onVraagAi} />
      ) : (
        <>
          <div className="space-y-1 text-base" data-testid="github-status">
            <p className="flex flex-wrap items-center gap-2">
              {link.privaat ? <LockIcon className="size-4" aria-hidden="true" /> : null}
              <span className="font-medium">{link.eigenaar}/{link.repo}</span>
              <span className="text-muted-foreground">({link.privaat ? t("github.privaat") : t("github.openbaar")})</span>
            </p>
            <p data-testid="github-laatste" className="text-muted-foreground">
              {link.laatste ? t("github.laatste", { wanneer: tijdGeleden(t, link.laatste, state.nu) }) : t("github.nogNiet")}
            </p>
            <p className="text-muted-foreground" data-testid="github-nieuw">
              {state.nieuw === 0 ? t("github.nieuwGeen") : state.nieuw === 1 ? t("github.nieuwEen") : t("github.nieuwMeer", { aantal: state.nieuw })}
            </p>
          </div>

          {link.uiteengelopen && <Uiteengelopen soort={link.uiteengelopen} onVraagAi={onVraagAi} />}
          {link.probleem && !link.uiteengelopen && (
            <Alert className="border-warning/50 bg-warning/10" data-testid="github-probleem">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription className="text-base text-foreground">{t(`github.uitkomst.${link.probleem}`, { defaultValue: t("github.uitkomst.onbekend") })}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button data-testid="github-bijwerken" onClick={() => void bijwerken()} disabled={bezig || state.bezig}>
              {bezig || state.bezig ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
              {t("github.bijwerken")}
            </Button>
            <Button variant="outline" onClick={() => void connectOpen(link.url).catch(() => undefined)}>
              <ExternalLinkIcon aria-hidden="true" />
              {t("github.openRepo")}
            </Button>
          </div>
          {(bezig || state.bezig) && voortgang && (
            <div className="space-y-1" data-testid="github-voortgang">
              <p className="text-sm text-muted-foreground">{t(`github.stap.${voortgang.stap}`, { defaultValue: t("github.stap.bezig") })}</p>
              {voortgang.totaal > 0 && <Progress value={Math.round((voortgang.klaar / voortgang.totaal) * 100)} aria-label={t("github.voortgang")} />}
            </div>
          )}
          {uitkomst && <UitkomstMelding u={uitkomst} onVraagAi={onVraagAi} />}

          <div className="space-y-3 border-t pt-3">
            <div className="flex items-start gap-3">
              <Switch id="gh-auto" checked={link.auto} onCheckedChange={(c) => void githubSetAuto(projectId, c).then(ververs)} />
              <Label htmlFor="gh-auto" className="min-h-9 flex-1 text-base">
                {t("github.auto")}
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Switch id="gh-ai" checked={link.ai_vraagt} onCheckedChange={(c) => void githubSetAiAsk(projectId, c).then(ververs)} />
              <Label htmlFor="gh-ai" className="min-h-9 flex-1 text-base">
                {t("github.aiVraagt")}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">{t("github.alleenVooruit")}</p>
            <Button variant="ghost" size="sm" onClick={() => void githubUnlink(projectId).then(ververs)}>
              {t("github.ontkoppel")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Uiteengelopen({ soort, onVraagAi }: { soort: "uiteengelopen" | "online_nieuwer"; onVraagAi?: (p: string) => void }) {
  const { t } = useTranslation();
  return (
    <Alert className="border-warning/50 bg-warning/10" data-testid="github-uiteengelopen">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{t(`github.uiteen.${soort}.titel`)}</AlertTitle>
      <AlertDescription className="space-y-2 text-base text-foreground">
        <p>{t(`github.uiteen.${soort}.uitleg`)}</p>
        <p className="font-medium">{t("github.uiteen.opties")}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("github.uiteen.optieNiets")}</li>
          <li>{t("github.uiteen.optieAi")}</li>
          <li>{t("github.uiteen.optieNieuw")}</li>
        </ul>
        {onVraagAi && (
          <Button variant="outline" onClick={() => onVraagAi(t("github.uiteen.prompt"))}>
            {t("github.uiteen.vraagAi")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function EersteKeer({ projectId, onKlaar, uitkomst, onVraagAi }: { projectId: number; onKlaar: (u: GhUitkomst) => void; uitkomst: GhUitkomst | null; onVraagAi?: (p: string) => void }) {
  const { t } = useTranslation();
  const [naam, setNaam] = useState("");
  const [vrij, setVrij] = useState<boolean | null>(null);
  const [geldig, setGeldig] = useState(true);
  const [openbaar, setOpenbaar] = useState(false);
  const [snap, setSnap] = useState(false);
  const [bezig, setBezig] = useState(false);

  // Een voorstel voor de naam, uit de projectnaam, en meteen of die nog vrij is.
  useEffect(() => {
    let off = false;
    void Promise.resolve(githubSuggestName(projectId)).then(
      (r) => {
        if (off || !r) return;
        setNaam(r.naam);
        setGeldig(r.geldig !== false);
        setVrij(r.vrij ?? null);
      },
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [projectId]);

  async function controleer(n: string) {
    setNaam(n);
    setVrij(null);
    try {
      const r = await githubSuggestName(projectId, n);
      setGeldig(r.geldig !== false);
      setVrij(r.vrij ?? null);
    } catch {
      /* geen internet: de echte fout komt bij het maken */
    }
  }

  async function maak() {
    setBezig(true);
    try {
      onKlaar(await githubFirstBackup(projectId, naam, openbaar, snap));
    } catch (e) {
      onKlaar({ status: "mislukt", code: "onverwacht", params: { detail: String(e) } });
    } finally {
      setBezig(false);
    }
  }

  const kan = naam.length > 0 && geldig && vrij !== false && (!openbaar || snap) && !bezig;
  return (
    <div className="space-y-4" data-testid="github-eerste">
      <p className="text-base">{t("github.eerste.uitleg")}</p>
      <ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
        <li>{t("github.eerste.punt1")}</li>
        <li>{t("github.eerste.punt2")}</li>
        <li>{t("github.eerste.punt3")}</li>
      </ul>
      <div className="space-y-2">
        <Label htmlFor="gh-naam" className="text-base">
          {t("github.eerste.naam")}
        </Label>
        <Input id="gh-naam" value={naam} onChange={(e) => void controleer(e.target.value)} data-testid="github-naam" aria-describedby="gh-naam-hulp" />
        <p id="gh-naam-hulp" className="text-sm text-muted-foreground" data-testid="github-naam-status">
          {!geldig ? t("github.eerste.naamOngeldig") : vrij === false ? t("github.eerste.naamBezet") : vrij === true ? t("github.eerste.naamVrij") : t("github.eerste.naamHulp")}
        </p>
      </div>
      <RadioGroup value={openbaar ? "openbaar" : "privaat"} onValueChange={(v) => { setOpenbaar(v === "openbaar"); setSnap(false); }} className="space-y-2" aria-label={t("github.eerste.zichtbaarheid")}>
        <div className="flex items-start gap-3">
          <RadioGroupItem value="privaat" id="gh-priv" />
          <Label htmlFor="gh-priv" className="min-h-9 flex-1 text-base">
            <span className="font-medium">{t("github.eerste.privaat")}</span> — {t("github.eerste.privaatUitleg")}
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <RadioGroupItem value="openbaar" id="gh-open" />
          <Label htmlFor="gh-open" className="min-h-9 flex-1 text-base">
            <span className="font-medium">{t("github.eerste.openbaar")}</span> — {t("github.eerste.openbaarUitleg")}
          </Label>
        </div>
      </RadioGroup>
      {openbaar && (
        <Alert className="border-warning/50 bg-warning/10" data-testid="github-openbaar-waarschuwing">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="space-y-2 text-base text-foreground">
            <p>{t("github.eerste.openbaarWaarschuwing")}</p>
            <div className="flex items-start gap-3">
              <Checkbox id="gh-snap" checked={snap} onCheckedChange={(c) => setSnap(c === true)} />
              <Label htmlFor="gh-snap" className="min-h-9 flex-1 text-base">
                {t("github.eerste.openbaarSnap")}
              </Label>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <Button data-testid="github-maak" onClick={() => void maak()} disabled={!kan}>
        {bezig ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
        {t("github.eerste.knop")}
      </Button>
      {uitkomst && <UitkomstMelding u={uitkomst} onVraagAi={onVraagAi} />}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { vercelEnvList, vercelEnvRemove, vercelEnvSet, vercelEnvSupabase, type VercelEnv, type VercelUitkomst } from "@/lib/api";
import { useConnections } from "@/components/app/connect/connections-provider";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useVercel } from "./use-vercel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  projectId: number;
  tick?: number;
  onChanged?: () => void;
}

const OMGEVINGEN = ["production", "preview", "development"] as const;

/**
 * Omgevingsvariabelen per omgeving (echt, voorbeeld, ontwikkeling). De waarde gaat rechtstreeks naar de beveiligde kluis van je computer
 * en wordt nooit getoond, ook niet aan de AI. Een geheime sleutel mag alleen als "server" en nooit in iets wat de browser ziet.
 */
export default function Variabelen({ projectId, tick = 0, onChanged }: Props) {
  const { t } = useTranslation();
  const { state, ververs: verversState } = useVercel(projectId, tick);
  const ontbrekend = state.ontbrekend;
  const serverDeel = state.server_deel;
  const { van } = useConnections();
  const supabase = van("supabase")?.status === "werkt";
  const [lijst, setLijst] = useState<VercelEnv[]>([]);
  const [naam, setNaam] = useState("");
  const [waarde, setWaarde] = useState("");
  const [soort, setSoort] = useState<"openbaar" | "server">("openbaar");
  const [omg, setOmg] = useState<string[]>(["production", "preview"]);
  const [melding, setMelding] = useState<VercelUitkomst | null>(null);
  const [vraag, setVraag] = useState<null | "opslaan" | "supabase">(null);

  const ververs = useCallback(async () => {
    try {
      const l = await vercelEnvList(projectId);
      if (Array.isArray(l)) setLijst(l);
    } catch {
      /* geen lijst bij een storing */
    }
  }, [projectId]);

  useEffect(() => {
    let off = false;
    void Promise.resolve(vercelEnvList(projectId)).then(
      (l) => !off && Array.isArray(l) && setLijst(l),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [projectId]);

  async function opslaan(bevestigd: boolean) {
    setVraag(null);
    try {
      const u = await vercelEnvSet(projectId, naam.trim(), waarde, soort, omg, bevestigd);
      setMelding(u);
      if (u.status === "uitgevoerd") {
        setNaam("");
        setWaarde("");
      }
    } catch {
      setMelding({ status: "mislukt", code: "onverwacht", params: {} });
    }
    await ververs();
    await verversState();
    onChanged?.();
  }

  async function supabaseOvernemen() {
    setVraag(null);
    try {
      setMelding(await vercelEnvSupabase(projectId, true));
    } catch {
      setMelding({ status: "mislukt", code: "onverwacht", params: {} });
    }
    await ververs();
    await verversState();
    onChanged?.();
  }

  const tekst = melding ? (melding.code === "env_ongeldig" ? t(`vercel.env.fout.${String(melding.params.reden)}`, { defaultValue: t("vercel.env.fout.onbekend") }) : t(`vercel.env.uitkomst.${melding.code}`, { defaultValue: t(`vercel.uitkomst.${melding.code}`, { defaultValue: t("vercel.uitkomst.onbekend") }) })) : "";
  const kan = naam.trim().length > 0 && waarde.length > 0 && omg.length > 0;
  return (
    <section className="space-y-4 rounded-xl border-2 border-border p-4" data-testid="vercel-variabelen" aria-labelledby="vercel-var-titel">
      <h3 id="vercel-var-titel" className="text-lg font-semibold">
        {t("vercel.env.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("vercel.env.uitleg")}</p>

      {ontbrekend.length > 0 && (
        <Alert className="border-warning/50 bg-warning/10" data-testid="vercel-ontbrekend">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-base text-foreground">
            {t("vercel.env.ontbreekt")} <span className="font-mono text-sm">{ontbrekend.join(", ")}</span>
          </AlertDescription>
        </Alert>
      )}

      {supabase && (
        <div className="space-y-2" data-testid="vercel-supabase-aanbod">
          <p className="text-base">{t("vercel.env.supabase")}</p>
          <Button variant="outline" data-testid="vercel-supabase-knop" onClick={() => setVraag("supabase")}>
            {t("vercel.env.supabaseKnop")}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="vv-naam" className="text-base">
            {t("vercel.env.naam")}
          </Label>
          <Input id="vv-naam" value={naam} onChange={(e) => setNaam(e.target.value.toUpperCase())} placeholder="SITE_NAAM" data-testid="vercel-env-naam" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vv-waarde" className="text-base">
            {t("vercel.env.waarde")}
          </Label>
          <Input id="vv-waarde" type="password" value={waarde} onChange={(e) => setWaarde(e.target.value)} data-testid="vercel-env-waarde" autoComplete="off" />
          <p className="text-sm text-muted-foreground">{t("vercel.env.waardeHulp")}</p>
        </div>
        <RadioGroup value={soort} onValueChange={(v) => setSoort(v as "openbaar" | "server")} className="space-y-2" aria-label={t("vercel.env.soort")}>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="openbaar" id="vv-openbaar" />
            <Label htmlFor="vv-openbaar" className="min-h-9 flex-1 text-base">
              <span className="font-medium">{t("vercel.env.openbaar")}</span> — {t("vercel.env.openbaarUitleg")}
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="server" id="vv-server" disabled={!serverDeel} />
            <Label htmlFor="vv-server" className="min-h-9 flex-1 text-base">
              <span className="font-medium">{t("vercel.env.server")}</span> — {serverDeel ? t("vercel.env.serverUitleg") : t("vercel.env.serverUit")}
            </Label>
          </div>
        </RadioGroup>
        {soort === "server" && (
          <Alert className="border-warning/50 bg-warning/10" data-testid="vercel-server-waarschuwing">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription className="text-base text-foreground">{t("vercel.env.serverWaarschuwing")}</AlertDescription>
          </Alert>
        )}
        <fieldset className="space-y-1">
          <legend className="text-base font-medium">{t("vercel.env.omgevingen")}</legend>
          {OMGEVINGEN.map((o) => (
            <div key={o} className="flex items-center gap-3">
              <Checkbox id={`vv-${o}`} checked={omg.includes(o)} onCheckedChange={(c) => setOmg((l) => (c === true ? [...l, o] : l.filter((x) => x !== o)))} />
              <Label htmlFor={`vv-${o}`} className="min-h-9 flex-1 text-base">
                {t(`vercel.env.omg.${o}`)}
              </Label>
            </div>
          ))}
        </fieldset>
        <Button data-testid="vercel-env-opslaan" disabled={!kan} onClick={() => (omg.includes("production") ? setVraag("opslaan") : void opslaan(false))}>
          {t("vercel.env.opslaan")}
        </Button>
      </div>

      {melding && (
        <Alert role="status" data-testid="vercel-env-melding" data-code={melding.code} className={melding.status === "uitgevoerd" ? "border-success/50 bg-success/10" : "border-warning/50 bg-warning/10"}>
          {melding.status === "uitgevoerd" ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertDescription className="text-base text-foreground">{tekst}</AlertDescription>
        </Alert>
      )}

      {lijst.length > 0 && (
        <ul className="space-y-2" data-testid="vercel-env-lijst">
          {lijst.map((e) => (
            <li key={e.naam} className="flex flex-wrap items-center gap-2 text-base" data-naam={e.naam}>
              <LockIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono text-sm">{e.naam}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-sm">{e.soort === "server" ? t("vercel.env.server") : t("vercel.env.openbaar")}</span>
              <span className="text-sm text-muted-foreground">{e.omgevingen.map((o) => t(`vercel.env.omg.${o}`)).join(", ")}</span>
              <span className="text-sm text-muted-foreground">{e.doorgestuurd ? t("vercel.env.doorgestuurd") : t("vercel.env.nogNiet")}</span>
              <span className="text-sm text-muted-foreground">{t("vercel.env.bewaard")}</span>
              <Button variant="ghost" size="sm" onClick={() => void vercelEnvRemove(projectId, e.naam).then(ververs).then(() => onChanged?.())}>
                {t("vercel.env.verwijder")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={vraag !== null} onOpenChange={(o) => !o && setVraag(null)}>
        <AlertDialogContent data-testid="vercel-env-dialoog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("vercel.env.vraagTitel")}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">{t("vercel.env.vraagUitleg")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("vercel.liveVraag.nee")}</AlertDialogCancel>
            <AlertDialogAction data-testid="vercel-env-ja" onClick={() => void (vraag === "supabase" ? supabaseOvernemen() : opslaan(true))}>
              {t("vercel.env.vraagJa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

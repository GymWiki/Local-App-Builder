import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2Icon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { supaCreate, supaLink, supaProjects, supaStatus, supaUnlink, supaWake, supaWriteConfig, type SupaProject } from "@/lib/api";
import VerbindKnop from "@/components/app/connect/VerbindKnop";
import { useConnections } from "@/components/app/connect/connections-provider";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSupa } from "./use-supa";

type Stap = "kiezen" | "maken" | "wachten";

/**
 * Stappen om Supabase te gebruiken: (1-3) verbinden met je eigen account (de Verbind-knop), (4) een project kiezen of maken, (5) klaar.
 * Het databasewachtwoord van een nieuw project maakt Studio zelf en bewaart het in de kluis; het komt hier nooit in beeld.
 */
export default function SupabaseKoppeling({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { van } = useConnections();
  const { state, ververs } = useSupa(projectId);
  const k = van("supabase");
  const verbonden = k?.status === "werkt";
  const [stap, setStap] = useState<Stap>("kiezen");
  const [projecten, setProjecten] = useState<SupaProject[] | null>(null);
  const [keuze, setKeuze] = useState("");
  const [naam, setNaam] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [gepauzeerd, setGepauzeerd] = useState(false);
  const [ontkoppel, setOntkoppel] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // Verbonden maar nog geen project gekozen: de lijst met projecten ophalen.
  useEffect(() => {
    if (!verbonden || state.gekoppeld) return;
    let weg = false;
    void Promise.resolve(supaProjects())
.then((r) => {
        if (weg) return;
        if (r.fout) setFout(r.fout);
        else {
          setProjecten(r.projecten ?? []);
          setKeuze(r.projecten?.[0]?.reference ?? "");
        }
      })
      .catch(() => !weg && setFout("onverwacht"));
    return () => {
      weg = true;
    };
  }, [verbonden, state.gekoppeld]);

  // Gekoppeld: is het project gepauzeerd?
  useEffect(() => {
    if (!state.gekoppeld) return;
    let weg = false;
    void Promise.resolve(supaStatus(projectId))
.then((r) => !weg && setGepauzeerd(!!(r.data as { gepauzeerd?: boolean } | undefined)?.gepauzeerd))
      .catch(() => undefined);
    return () => {
      weg = true;
    };
  }, [state.gekoppeld, projectId]);

  useEffect(
    () => () => {
      if (poll.current) clearInterval(poll.current);
    },
    [],
  );

  const klaarMetConfig = async () => {
    await supaWriteConfig(projectId).catch(() => undefined);
    await ververs();
  };

  const gebruik = async () => {
    setBezig(true);
    setFout(null);
    try {
      const r = await supaLink(projectId, keuze);
      if (r.status !== "uitgevoerd") setFout(r.tekst);
      else {
        await klaarMetConfig();
        toast.success(t("gegevens.wizard.klaar"));
      }
    } catch (e) {
      setFout(String(e));
    } finally {
      setBezig(false);
    }
  };

  const maak = async () => {
    setBezig(true);
    setFout(null);
    try {
      const r = await supaCreate(projectId, naam.trim());
      if (r.status !== "uitgevoerd") {
        setFout(r.tekst);
        setBezig(false);
        return;
      }
      await ververs();
      setStap("wachten");
      // Wachten tot het project klaar is (ongeveer twee minuten); intussen kan de gebruiker doorwerken.
      poll.current = setInterval(() => {
        void Promise.resolve(supaStatus(projectId))
.then(async (s) => {
          const d = s.data as { status?: string } | undefined;
          if (d?.status === "ACTIVE_HEALTHY") {
            if (poll.current) clearInterval(poll.current);
            await klaarMetConfig();
            setStap("kiezen");
            toast.success(t("gegevens.wizard.klaar"));
          }
        });
      }, 5000);
    } catch (e) {
      setFout(String(e));
    } finally {
      setBezig(false);
    }
  };

  const foutTekst = (f: string) => {
    const code = f.replace(/^.*?(plan_limiet).*$/s, "$1");
    if (code === "plan_limiet") return t("gegevens.wizard.limiet");
    return t(`koppelingen.fout.${f}`, { defaultValue: f });
  };

  return (
    <section className="space-y-3 rounded-xl border-2 border-border p-4" data-testid="supabase-koppeling">
      <h3 className="text-lg font-semibold">{t("gegevens.koppeling.titel")}</h3>
      <p className="text-base text-muted-foreground">{t("gegevens.koppeling.uitleg")}</p>
      <p className="text-sm text-muted-foreground">{t("gegevens.koppeling.privacy")}</p>

      {/* Stap 1-3: verbinden met je eigen account */}
      <VerbindKnop id="supabase" />

      {verbonden && !state.gekoppeld && stap !== "wachten" && (
        <div className="space-y-4 border-t border-border pt-3" data-testid="supabase-kies">
          <h4 className="text-base font-semibold">{t("gegevens.wizard.titel")}</h4>
          <p className="text-base text-muted-foreground">{t("gegevens.wizard.uitleg")}</p>
          {projecten === null && !fout && (
            <p className="flex items-center gap-2 text-base text-muted-foreground" role="status">
              <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
              {t("gegevens.wizard.laden")}
            </p>
          )}
          {projecten && projecten.length > 0 && (
            <Field>
              <FieldLabel htmlFor="supa-project">{t("gegevens.wizard.bestaand")}</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Select value={keuze} onValueChange={setKeuze}>
                  <SelectTrigger id="supa-project" className="min-w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projecten.map((p) => (
                      <SelectItem key={p.reference} value={p.reference}>
                        {p.name} ({p.region})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button disabled={!keuze || bezig} onClick={() => void gebruik()}>
                  {t("gegevens.wizard.kies")}
                </Button>
              </div>
            </Field>
          )}
          {projecten && projecten.length === 0 && <p className="text-base">{t("gegevens.wizard.geenProjecten")}</p>}
          <Field>
            <FieldLabel htmlFor="supa-nieuw">{t("gegevens.wizard.naamLabel")}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Input id="supa-nieuw" className="min-w-64 flex-1" value={naam} maxLength={60} placeholder={t("gegevens.wizard.naamPlaats")} onChange={(e) => setNaam(e.target.value)} />
              <Button variant="outline" disabled={!naam.trim() || bezig} onClick={() => void maak()} data-testid="supa-maak">
                {t("gegevens.wizard.maak")}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t("gegevens.wizard.regio")}</p>
            <p className="text-sm text-muted-foreground">{t("gegevens.wizard.wachtwoord")}</p>
            <p className="text-sm text-muted-foreground">{t("gegevens.wizard.wachttijd")}</p>
          </Field>
          {fout && (
            <Alert variant="destructive" data-testid="supa-fout">
              <AlertDescription>{foutTekst(fout)}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {stap === "wachten" && (
        <p className="flex items-center gap-2 text-base" role="status" data-testid="supa-wachten">
          <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
          {t("gegevens.koppeling.opstarten")}
        </p>
      )}

      {/* Stap 5: klaar */}
      {state.gekoppeld && (
        <div className="space-y-3 border-t border-border pt-3" data-testid="supabase-gekoppeld">
          <p className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2Icon className="size-5 text-success" aria-hidden="true" />
            {t("gegevens.koppeling.gekoppeld", { naam: state.naam, regio: state.regio || "—" })}
          </p>
          <p className="text-base text-muted-foreground">{t("gegevens.koppeling.klaarVoor")}</p>
          {gepauzeerd && (
            <Alert className="border-warning/50 bg-warning/10" data-testid="supa-gepauzeerd">
              <AlertDescription className="space-y-2 text-base text-foreground">
                <p>{t("gegevens.koppeling.gepauzeerd")}</p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void supaWake(projectId).then((r) => {
                      if (r.status === "uitgevoerd") toast.success(t("gegevens.koppeling.wakkerKlaar"));
                      else toast.error(r.tekst);
                    })
                  }
                >
                  {t("gegevens.koppeling.wakker")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOntkoppel(true)}>
            {t("gegevens.koppeling.ontkoppel")}
          </Button>
          <AlertDialog open={ontkoppel} onOpenChange={setOntkoppel}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("gegevens.koppeling.ontkoppel")}</AlertDialogTitle>
                <AlertDialogDescription>{t("gegevens.koppeling.ontkoppelUitleg")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("koppelingen.knop.annuleer")}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setOntkoppel(false);
                    void supaUnlink(projectId)
                      .catch(() => undefined)
                      .then(ververs);
                  }}
                >
                  {t("gegevens.koppeling.ontkoppel")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </section>
  );
}

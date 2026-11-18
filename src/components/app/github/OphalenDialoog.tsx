import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { CheckIcon, LoaderCircleIcon, LockIcon } from "lucide-react";
import { githubImport, githubListRepos, kiesMap, type GhHerkend, type GhRepo, type Project } from "@/lib/api";
import VerbindKnop from "@/components/app/connect/VerbindKnop";
import { useSettings } from "@/components/app/settings-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

interface Props {
  onClose: () => void;
  onImported: (p: Project) => void | Promise<void>;
}

/** Een project van je eigen GitHub ophalen: kiezen uit je lijst, naar een nieuwe map kopiëren en vertellen wat Studio herkent. */
export default function OphalenDialoog({ onClose, onImported }: Props) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [zoek, setZoek] = useState("");
  const [gekozen, setGekozen] = useState<GhRepo | null>(null);
  const [map, setMap] = useState(settings.default_project_dir ?? "");
  const [bezig, setBezig] = useState(false);
  const [voortgang, setVoortgang] = useState<{ klaar: number; totaal: number } | null>(null);
  const [klaar, setKlaar] = useState<{ project: Project; herkend: GhHerkend } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let off = false;
    void Promise.resolve(githubListRepos()).then(
      (r) => {
        if (off || !r) return;
        if (r.fout) setFout(r.fout);
        else {
          setFout(null);
          setRepos(r.repos ?? []);
        }
      },
      () => !off && setFout("onverwacht"),
    );
    return () => {
      off = true;
    };
  }, [nonce]);

  useEffect(() => {
    let weg = false;
    let off: (() => void) | undefined;
    void listen<{ klaar: number; totaal: number }>("github-import-voortgang", (e) => setVoortgang(e.payload))
      .then((u) => (weg ? u() : (off = u)))
      .catch(() => undefined);
    return () => {
      weg = true;
      off?.();
    };
  }, []);

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLocaleLowerCase("nl");
    return (repos ?? []).filter((r) => !q || `${r.eigenaar}/${r.naam} ${r.beschrijving}`.toLocaleLowerCase("nl").includes(q));
  }, [repos, zoek]);

  async function haalOp() {
    if (!gekozen) return;
    setBezig(true);
    setFout(null);
    try {
      const r = await githubImport(gekozen.eigenaar, gekozen.naam, gekozen.privaat, map);
      if (r.project && r.herkend) setKlaar({ project: r.project, herkend: r.herkend });
      else setFout(r.fout ?? "onverwacht");
    } catch {
      setFout("onverwacht");
    } finally {
      setBezig(false);
    }
  }

  const nietGekoppeld = fout === "niet_gekoppeld" || fout === "ongeldig_token";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="ophalen-dialoog">
        <DialogHeader>
          <DialogTitle>{t("github.ophalen.titel")}</DialogTitle>
          <DialogDescription>{t("github.ophalen.uitleg")}</DialogDescription>
        </DialogHeader>
        {klaar ? (
          <div className="space-y-3" data-testid="ophalen-klaar">
            <Alert className="border-success/50 bg-success/10">
              <CheckIcon aria-hidden="true" />
              <AlertDescription className="text-base text-foreground">{t("github.ophalen.klaar", { naam: klaar.project.naam })}</AlertDescription>
            </Alert>
            <p className="text-base">{t(`github.ophalen.soort.${klaar.herkend.soort}`, { defaultValue: t("github.ophalen.soort.unsupported") })}</p>
            {klaar.herkend.niet_herkend.length > 0 && (
              <div data-testid="ophalen-niet-herkend">
                <p className="font-medium">{t("github.ophalen.nietTitel")}</p>
                <ul className="list-disc space-y-1 pl-5 text-base">
                  {klaar.herkend.niet_herkend.map((c) => (
                    <li key={c}>{t(`github.ophalen.niet.${c}`, { defaultValue: c })}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button data-testid="ophalen-open" onClick={() => void onImported(klaar.project)}>
                {t("github.ophalen.open")}
              </Button>
            </DialogFooter>
          </div>
        ) : nietGekoppeld ? (
          <div className="space-y-3">
            <p className="text-base">{t("github.ophalen.eerstVerbinden")}</p>
            <VerbindKnop id="github" onConnected={() => setNonce((n) => n + 1)} />
          </div>
        ) : (
          <div className="space-y-3">
            <Input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label={t("github.ophalen.zoek")} placeholder={t("github.ophalen.zoek")} />
            {repos === null && !fout && <p className="text-base text-muted-foreground">{t("github.ophalen.laden")}</p>}
            {repos && zichtbaar.length === 0 && <p className="text-base text-muted-foreground">{t("github.ophalen.geen")}</p>}
            <ul className="max-h-64 space-y-2 overflow-y-auto" data-testid="ophalen-lijst">
              {zichtbaar.map((r) => {
                const aan = gekozen?.eigenaar === r.eigenaar && gekozen.naam === r.naam;
                return (
                  <li key={`${r.eigenaar}/${r.naam}`}>
                    <Button variant={aan ? "default" : "outline"} aria-pressed={aan} className="h-auto w-full justify-start gap-3 whitespace-normal py-2 text-left" onClick={() => setGekozen(r)}>
                      {r.privaat ? <LockIcon className="size-4" aria-hidden="true" /> : null}
                      <span className="flex-1">
                        <span className="block font-medium">{r.eigenaar}/{r.naam}</span>
                        {r.beschrijving && <span className="block text-sm font-normal opacity-80">{r.beschrijving}</span>}
                      </span>
                      <span className="text-sm font-normal">{r.privaat ? t("github.privaat") : t("github.openbaar")}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => void kiesMap(map || undefined).then((m) => m && setMap(m))}>
                {t("nieuw.kiesMap")}
              </Button>
              <span className="min-w-0 truncate text-muted-foreground">{map || t("nieuw.geenMap")}</span>
            </div>
            {bezig && voortgang && voortgang.totaal > 0 && <Progress value={Math.round((voortgang.klaar / voortgang.totaal) * 100)} aria-label={t("github.ophalen.bezig")} />}
            {fout && !nietGekoppeld && (
              <Alert variant="destructive" data-testid="ophalen-fout">
                <AlertDescription>{t(`github.ophalen.fout.${fout}`, { defaultValue: t("github.uitkomst.onbekend") })}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {t("nieuw.annuleer")}
              </Button>
              <Button data-testid="ophalen-start" disabled={!gekozen || !map || bezig} onClick={() => void haalOp()}>
                {bezig ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
                {bezig ? t("github.ophalen.bezig") : t("github.ophalen.knop")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

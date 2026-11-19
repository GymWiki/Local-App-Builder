import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, CircleAlertIcon, CopyIcon, LockIcon } from "lucide-react";
import { winkelsTekstConcept, winkelsTekstGoedkeuren, winkelsTekstGeschiedenis, winkelsTekstOntgrendel, winkelsTeksten, type WinkelVeldStand, type WinkelVersie } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

/** Telt zoals de winkel: in zichtbare tekens (een emoji is één) of in bytes. De limieten komen van Rust (uit store-spec.json). */
export function tel(eenheid: "tekens" | "bytes", tekst: string): number {
  if (eenheid === "bytes") return new TextEncoder().encode(tekst).length;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(tekst)].length : [...tekst].length;
}

interface Props {
  projectId: number;
  talen: string[];
  onVraagAi: (prompt: string) => void;
  onGewijzigd?: () => void;
  tick?: number;
}

function VeldRij({ projectId, winkel, taal, stand, onKlaar, onVraagAi }: { projectId: number; winkel: string; taal: string; stand: WinkelVeldStand; onKlaar: () => void; onVraagAi: (p: string) => void }) {
  const { t } = useTranslation();
  const vergrendeld = !!stand.goedgekeurd && !stand.concept;
  const bron = stand.concept?.tekst ?? stand.goedgekeurd?.tekst ?? "";
  // De tekst begint bij wat er is opgeslagen; verandert dat (opslaan, goedkeuren), dan krijgt dit veld een nieuwe `key` en begint het opnieuw.
  const [tekst, setTekst] = useState(bron);
  const [geschiedenis, setGeschiedenis] = useState<WinkelVersie[] | null>(null);
  const { eenheid, max, min } = stand;
  const n = tel(eenheid, tekst);
  const goed = tekst.trim().length > 0 ? n <= max && n >= min : min === 0;
  const naam = t(`winkels.veld.${stand.veld}`, { defaultValue: stand.veld });

  async function opslaan() {
    const r = await winkelsTekstConcept(projectId, winkel, taal, stand.veld, tekst);
    if (r.fout) toast.error(t("winkels.teksten.fout"));
    onKlaar();
  }
  async function goedkeuren() {
    let id = stand.concept?.id;
    if (!id || stand.concept?.tekst !== tekst) {
      const r = await winkelsTekstConcept(projectId, winkel, taal, stand.veld, tekst);
      id = r.id;
    }
    if (!id) return;
    const r = await winkelsTekstGoedkeuren(projectId, id);
    if (r.fout) toast.error(t(`winkels.teksten.goedkeurFout.${r.fout}`, { defaultValue: t("winkels.teksten.fout") }));
    onKlaar();
  }
  const vraagAi = () => onVraagAi(t("winkels.teksten.aiPrompt", { winkel: t(`winkels.winkel.${winkel}`), taal: t(`winkels.taal.${taal}`), veld: stand.veld, officieel: stand.officieel, max: String(max), eenheid: t(`winkels.eenheid.${eenheid}`) }));

  return (
    <li className="space-y-2 rounded-lg bg-muted/50 p-3" data-veld={stand.veld} data-vergrendeld={vergrendeld ? "ja" : "nee"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`tk-${winkel}-${taal}-${stand.veld}`} className="text-base font-medium">
          {naam} <span className="text-sm font-normal text-muted-foreground">({stand.officieel})</span>
        </Label>
        <span className="flex items-center gap-1 text-sm" data-testid={`teller-${stand.veld}`} data-goed={goed ? "ja" : "nee"}>
          {goed ? <CheckIcon className="size-4 text-success" aria-hidden="true" /> : <CircleAlertIcon className="size-4 text-warning" aria-hidden="true" />}
          {t("winkels.teksten.teller", { aantal: n, max: String(max), eenheid: t(`winkels.eenheid.${eenheid}`) })}
        </span>
      </div>
      <Textarea id={`tk-${winkel}-${taal}-${stand.veld}`} data-testid={`tekst-${stand.veld}`} value={tekst} onChange={(e) => setTekst(e.target.value)} disabled={vergrendeld} rows={stand.veld.includes("beschrijving") ? 6 : 2} />
      {!stand.geverifieerd && <p className="text-xs text-muted-foreground">{t("winkels.teksten.nietGeverifieerd")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {vergrendeld ? (
          <>
            <span className="flex items-center gap-1 text-sm text-muted-foreground" data-testid={`vergrendeld-${stand.veld}`}>
              <LockIcon className="size-4" aria-hidden="true" />
              {t("winkels.teksten.goedgekeurd")}
            </span>
            <Button variant="outline" size="sm" data-testid={`ontgrendel-${stand.veld}`} onClick={() => void winkelsTekstOntgrendel(projectId, winkel, taal, stand.veld).then(onKlaar)}>
              {t("winkels.teksten.bewerk")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" data-testid={`opslaan-${stand.veld}`} onClick={() => void opslaan()}>
              {t("winkels.teksten.concept")}
            </Button>
            <Button size="sm" data-testid={`goedkeuren-${stand.veld}`} disabled={!goed || tekst.trim().length === 0} onClick={() => void goedkeuren()}>
              {t("winkels.teksten.keurGoed")}
            </Button>
            <Button variant="ghost" size="sm" data-testid={`ai-${stand.veld}`} onClick={vraagAi}>
              {t("winkels.teksten.laatAiSchrijven")}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(tekst).then(() => toast.success(t("winkels.gekopieerd")), () => undefined)}>
          <CopyIcon aria-hidden="true" />
          {t("winkels.kopieer")}
        </Button>
      </div>
      <Collapsible onOpenChange={(o) => o && void winkelsTekstGeschiedenis(projectId, winkel, taal, stand.veld).then(setGeschiedenis)}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            {t("winkels.teksten.geschiedenis")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-1 space-y-1 text-sm" data-testid={`geschiedenis-${stand.veld}`}>
            {(geschiedenis ?? []).map((v) => (
              <li key={v.id}>
                <span className="text-muted-foreground">
                  {t(`winkels.teksten.status.${v.status}`)} · {t(`winkels.teksten.bron.${v.bron}`)}:
                </span>{" "}
                {v.tekst}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** Winkelpakket → Teksten: per winkel en taal de velden met teller (✓/!), concept, goedkeuren (vergrendelen) en geschiedenis. De AI schrijft alleen concepten. */
export default function Teksten({ projectId, talen, onVraagAi, onGewijzigd, tick = 0 }: Props) {
  const { t } = useTranslation();
  const [winkel, setWinkel] = useState<"play" | "appstore">("appstore");
  const [gekozenTaal, setTaal] = useState(talen[0] ?? "nl");
  const taal = talen.includes(gekozenTaal) ? gekozenTaal : (talen[0] ?? "nl");
  const [velden, setVelden] = useState<WinkelVeldStand[]>([]);
  const [nonce, setNonce] = useState(0);

  const laad = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let off = false;
    void Promise.resolve(winkelsTeksten(projectId, winkel, taal)).then(
      (r) => !off && Array.isArray(r) && setVelden(r),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [projectId, winkel, taal, nonce, tick]);

  return (
    <section className="space-y-3 rounded-xl border-2 border-border p-4" data-testid="winkelpakket-teksten" aria-labelledby="wp-teksten-titel">
      <h3 id="wp-teksten-titel" className="text-lg font-semibold">
        {t("winkels.teksten.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("winkels.teksten.uitleg")}</p>
      <div className="flex flex-wrap gap-6">
        <RadioGroup value={winkel} onValueChange={(v) => setWinkel(v as "play" | "appstore")} className="gap-2" aria-label={t("winkels.teksten.kiesWinkel")}>
          {(["appstore", "play"] as const).map((w) => (
            <div key={w} className="flex items-center gap-3">
              <RadioGroupItem value={w} id={`tw-${w}`} />
              <Label htmlFor={`tw-${w}`} className="min-h-9 text-base">
                {t(`winkels.winkel.${w}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <RadioGroup value={taal} onValueChange={setTaal} className="gap-2" aria-label={t("winkels.teksten.kiesTaal")}>
          {talen.map((l) => (
            <div key={l} className="flex items-center gap-3">
              <RadioGroupItem value={l} id={`tt-${l}`} />
              <Label htmlFor={`tt-${l}`} className="min-h-9 text-base">
                {t(`winkels.taal.${l}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <ul className="space-y-3">
        {velden.map((v) => (
          <VeldRij
            key={`${winkel}-${taal}-${v.veld}-${v.concept?.id ?? 0}-${v.goedgekeurd?.id ?? 0}`}
            projectId={projectId}
            winkel={winkel}
            taal={taal}
            stand={v}
            onVraagAi={onVraagAi}
            onKlaar={() => {
              laad();
              onGewijzigd?.();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

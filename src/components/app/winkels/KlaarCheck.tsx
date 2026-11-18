import { useTranslation } from "react-i18next";
import { CheckIcon, CircleAlertIcon, CircleIcon, HandIcon } from "lucide-react";
import type { WinkelAppData, WinkelPunt, WinkelPuntStatus, WinkelStand } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

/** Welke punten je zelf bij de winkel doet en hier bevestigt: punt → sleutel in `bevestigd` (of een eigen vlag). */
const BEVESTIG: Record<string, { winkel?: "play" | "appstore"; sleutel: string }> = {
  account: { sleutel: "account" },
  data_safety: { sleutel: "data_safety" },
  doelgroep: { sleutel: "doelgroep" },
  advertenties: { sleutel: "advertenties" },
  apple_privacy: { sleutel: "apple_privacy" },
  export_regels: { sleutel: "export_regels" },
  leeftijd: { sleutel: "leeftijd_ingevuld" },
  demo_account: { sleutel: "demo_account_gezet" },
};

export const sleutelVoor = (winkel: "play" | "appstore", id: string): string | null => {
  const b = BEVESTIG[id];
  if (!b) return null;
  return id === "account" ? (winkel === "play" ? "play_account" : "apple_account") : b.sleutel;
};

export function isAan(d: WinkelAppData, sleutel: string): boolean {
  if (sleutel === "leeftijd_ingevuld") return d.leeftijd_ingevuld;
  if (sleutel === "demo_account_gezet") return d.demo_account_gezet;
  return d.bevestigd[sleutel] === true;
}

export function zet(d: WinkelAppData, sleutel: string, aan: boolean): WinkelAppData {
  if (sleutel === "leeftijd_ingevuld") return { ...d, leeftijd_ingevuld: aan };
  if (sleutel === "demo_account_gezet") return { ...d, demo_account_gezet: aan };
  return { ...d, bevestigd: { ...d.bevestigd, [sleutel]: aan } };
}

function Icoon({ status }: { status: WinkelPuntStatus }) {
  const { t } = useTranslation();
  const label = t(`winkels.status.${status}`);
  if (status === "klaar") return <CheckIcon className="size-5 text-success" aria-label={label} />;
  if (status === "let_op") return <CircleAlertIcon className="size-5 text-warning" aria-label={label} />;
  if (status === "handmatig") return <HandIcon className="size-5 text-muted-foreground" aria-label={label} />;
  return <CircleIcon className="size-5 text-muted-foreground" aria-label={label} />;
}

function Detail({ p }: { p: WinkelPunt }) {
  const { t } = useTranslation();
  const d = p.detail ?? {};
  if (p.id === "teksten" && typeof d.klaar === "number") return <span className="text-sm text-muted-foreground"> ({t("winkels.detail.teksten", { klaar: d.klaar, totaal: String(d.totaal) })})</span>;
  if (p.id === "screenshots" && typeof d.aantal === "number") return <span className="text-sm text-muted-foreground"> ({t("winkels.detail.screenshots", { aantal: d.aantal, minimaal: String(d.minimaal) })})</span>;
  if (p.id === "app_id" && typeof d.code === "string") return <span className="text-sm text-muted-foreground"> ({t(`winkels.appid.${d.code}`, { defaultValue: d.code })})</span>;
  if (p.id === "versie" && typeof d.versie === "string") return <span className="text-sm text-muted-foreground"> ({d.versie})</span>;
  return null;
}

interface Props {
  stand: WinkelStand;
  data: WinkelAppData;
  onWijzig: (d: WinkelAppData) => void;
}

/** De klaar-check van één winkel: bolletjes, wat je nog moet doen, en wat je zelf bij de winkel doet kun je hier afvinken. */
export default function KlaarCheck({ stand, data, onWijzig }: Props) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 rounded-xl border-2 border-border p-4" data-testid={`klaar-${stand.winkel}`} aria-labelledby={`klaar-titel-${stand.winkel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`klaar-titel-${stand.winkel}`} className="text-lg font-semibold">
          {t(`winkels.winkel.${stand.winkel}`)}
        </h3>
        <span className="text-base text-muted-foreground" data-testid={`klaar-telling-${stand.winkel}`}>
          {t("winkels.klaarVan", { klaar: stand.klaar, totaal: stand.totaal })}
        </span>
      </div>
      <Progress value={Math.round((stand.klaar / Math.max(1, stand.totaal)) * 100)} aria-label={t("winkels.voortgang")} />
      <ul className="space-y-2">
        {stand.punten.map((p) => {
          const sleutel = sleutelVoor(stand.winkel, p.id);
          return (
            <li key={p.id} data-punt={p.id} data-status={p.status} className="flex items-start gap-3 text-base">
              <span className="mt-0.5">
                <Icoon status={p.status} />
              </span>
              <span className="flex-1">
                <span className="font-medium">{t(`winkels.punt.${p.id}.titel`)}</span>
                <Detail p={p} />
                <span className="block text-sm text-muted-foreground">{t(`winkels.punt.${p.id}.${p.status === "klaar" ? "klaar" : "uitleg"}`, { defaultValue: t(`winkels.punt.${p.id}.uitleg`) })}</span>
                {sleutel && p.status !== "klaar" && (
                  <span className="mt-1 flex items-center gap-2">
                    <Checkbox id={`b-${stand.winkel}-${p.id}`} checked={isAan(data, sleutel)} onCheckedChange={(c) => onWijzig(zet(data, sleutel, c === true))} />
                    <Label htmlFor={`b-${stand.winkel}-${p.id}`} className="min-h-9 text-base">
                      {t("winkels.ikHebDitGedaan")}
                    </Label>
                  </span>
                )}
                {sleutel && p.status === "klaar" && (
                  <span className="mt-1 flex items-center gap-2">
                    <Checkbox id={`b-${stand.winkel}-${p.id}`} checked onCheckedChange={(c) => onWijzig(zet(data, sleutel, c === true))} />
                    <Label htmlFor={`b-${stand.winkel}-${p.id}`} className="min-h-9 text-base">
                      {t("winkels.ikHebDitGedaan")}
                    </Label>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

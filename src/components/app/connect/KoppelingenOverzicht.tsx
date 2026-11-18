import { useState } from "react";
import { useTranslation } from "react-i18next";
import { connectTestAll, type DienstId } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConnections } from "./connections-provider";
import VerbindDialoog from "./VerbindDialoog";
import VerbindKnop from "./VerbindKnop";

const TOON: Record<string, string> = {
  werkt: "border-transparent bg-success/15 text-success",
  verlopen: "border-transparent bg-destructive/15 text-destructive",
  fout: "border-transparent bg-destructive/15 text-destructive",
  bezig: "border-transparent bg-accent text-accent-foreground",
  niet_gekoppeld: "border-transparent bg-muted text-muted-foreground",
};

/** Instellingen > Mijn programma > Koppelingen: alle diensten met status en dezelfde Verbind-knoppen, "Alles testen" en "Alles verbinden". */
export default function KoppelingenOverzicht() {
  const { t } = useTranslation();
  const { lijst, ververs } = useConnections();
  const [test, setTest] = useState(false);
  const [wizard, setWizard] = useState<DienstId[] | null>(null);
  const [positie, setPositie] = useState(0);

  const volgende = () => {
    if (wizard && positie + 1 < wizard.length) setPositie((p) => p + 1);
    else setWizard(null);
  };
  const alles = async () => {
    setTest(true);
    try {
      await connectTestAll();
    } catch {
      /* de statussen hieronder laten zien wat er mis is */
    }
    await ververs();
    setTest(false);
  };
  const open = lijst.filter((k) => k.status !== "werkt").map((k) => k.id);

  return (
    <div className="space-y-4" data-testid="koppelingen-overzicht">
      <p className="text-base text-muted-foreground">{t("koppelingen.privacy")}</p>
      {lijst.length === 0 && <p className="text-base">{t("koppelingen.overzicht.leeg")}</p>}
      <ul className="space-y-3">
        {lijst.map((k) => (
          <li key={k.id} data-dienst={k.id} className="space-y-2 rounded-xl border-2 border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-lg font-semibold">{t(`koppelingen.${k.id}.naam`)}</h4>
              <Badge data-testid={`koppel-status-${k.id}`} className={TOON[k.status]}>
                {t(`koppelingen.status.${k.status}`)}
              </Badge>
            </div>
            <p className="text-base text-muted-foreground">{t(`koppelingen.${k.id}.uitleg`)}</p>
            <p className="text-sm text-muted-foreground">
              {t("koppelingen.dialoog.functiesTitel")} {k.functies.map((f) => t(`koppelingen.${k.id}.functies.${f}`)).join(", ")}
            </p>
            {k.fout && k.status !== "werkt" && (
              <p role="status" className="text-sm text-destructive">
                {t(`koppelingen.fout.${k.fout}`, { defaultValue: t("koppelingen.fout.onverwacht") })}
              </p>
            )}
            <VerbindKnop id={k.id} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={test} onClick={() => void alles()}>
          {t("koppelingen.knop.allesTesten")}
        </Button>
        <Button
          variant="outline"
          disabled={open.length === 0}
          onClick={() => {
            setPositie(0);
            setWizard(open);
          }}
        >
          {t("koppelingen.knop.allesVerbinden")}
        </Button>
      </div>
      {wizard && (
        <div data-testid="alles-verbinden">
          <VerbindDialoog id={wizard[positie]} open onClose={volgende} onConnected={() => undefined} key={wizard[positie]} reeks={{ nu: positie + 1, totaal: wizard.length, onOverslaan: volgende }} />
        </div>
      )}
    </div>
  );
}

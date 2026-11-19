import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OctagonXIcon } from "lucide-react";
import { toast } from "sonner";
import { supaEmergency, supaSetDuration, supaSetLevel, type SupaNiveau } from "@/lib/api";
import Keuze from "@/components/app/settings/Keuze";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tijdTekst, useSupa } from "./use-supa";

const DUUR: [string, number][] = [
  ["minuten15", 900],
  ["uur1", 3600],
  ["uur2", 7200],
  ["uur4", 14400],
];

interface Props {
  projectId: number;
  /** Met de noodknop onder de keuze (standaard aan). */
  noodknop?: boolean;
}

/** Het bedieningsniveau van de AI voor dit project, met uitleg en voorbeelden. "Volledige controle" vraagt een waarschuwing en een getypte bevestiging. */
export default function NiveauKiezer({ projectId, noodknop = true }: Props) {
  const { t } = useTranslation();
  const { state, ververs } = useSupa(projectId);
  const [dialoog, setDialoog] = useState(false);
  const [typed, setTyped] = useState("");
  const [duur, setDuur] = useState("3600");
  const [fout, setFout] = useState(false);

  const kies = async (n: SupaNiveau) => {
    if (n === "volledig") {
      setTyped("");
      setFout(false);
      setDuur(String(state.volledig_secs || 3600));
      setDialoog(true);
      return;
    }
    await supaSetLevel(projectId, n).catch(() => undefined);
    await ververs();
  };

  const zetAan = async () => {
    if (typed.trim().toLowerCase() !== "volledig") {
      setFout(true);
      return;
    }
    try {
      await supaSetDuration(projectId, Number(duur));
      await supaSetLevel(projectId, "volledig", typed.trim());
      setDialoog(false);
      await ververs();
    } catch {
      setFout(true);
    }
  };

  const nood = async () => {
    await supaEmergency(projectId).catch(() => undefined);
    toast.success(t("gegevens.niveau.noodknopKlaar"));
    await ververs();
  };

  const niveaus: SupaNiveau[] = ["voorzichtig", "zelfstandig", "volledig"];
  return (
    <div className="space-y-3" data-testid="niveau-kiezer">
      <Keuze
        naam={`niveau-${projectId}`}
        label={t("gegevens.niveau.titel")}
        waarde={state.niveau}
        onChange={(v) => void kies(v)}
        opties={niveaus.map((n) => ({ value: n, titel: t(`gegevens.niveau.${n}.naam`), tekst: `${t(`gegevens.niveau.${n}.uitleg`)} ${t(`gegevens.niveau.${n}.voorbeeld`)}` }))}
      />
      {state.niveau === "volledig" && state.volledig_resterend != null && <p className="text-sm font-semibold text-destructive">{t("gegevens.niveau.balk.tekst", { tijd: tijdTekst(state.volledig_resterend) })}</p>}
      {noodknop && (
        <div className="space-y-1">
          <Button variant="destructive" onClick={() => void nood()} data-testid="noodknop">
            <OctagonXIcon aria-hidden="true" />
            {t("gegevens.niveau.noodknop")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("gegevens.niveau.noodknopUitleg")}</p>
        </div>
      )}

      <Dialog open={dialoog} onOpenChange={setDialoog}>
        <DialogContent data-testid="volledig-dialoog">
          <DialogHeader>
            <DialogTitle>{t("gegevens.niveau.volledigWaarschuwing.titel")}</DialogTitle>
            <DialogDescription>{t("gegevens.niveau.volledigWaarschuwing.tekst")}</DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertDescription>{t("gegevens.niveau.volledig.uitleg")}</AlertDescription>
          </Alert>
          <Field>
            <FieldLabel htmlFor="volledig-duur">{t("gegevens.niveau.volledigWaarschuwing.duurLabel")}</FieldLabel>
            <Select value={duur} onValueChange={setDuur}>
              <SelectTrigger id="volledig-duur" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUUR.map(([k, s]) => (
                  <SelectItem key={k} value={String(s)}>
                    {t(`gegevens.niveau.duur.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="volledig-typ">{t("gegevens.niveau.volledigWaarschuwing.typ")}</FieldLabel>
            <Input id="volledig-typ" autoComplete="off" value={typed} aria-invalid={fout} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void zetAan()} />
            {fout && <p className="text-sm text-destructive">{t("gegevens.niveau.volledigWaarschuwing.fout")}</p>}
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialoog(false)}>
              {t("koppelingen.knop.annuleer")}
            </Button>
            <Button variant="destructive" disabled={typed.trim().toLowerCase() !== "volledig"} onClick={() => void zetAan()} data-testid="volledig-aan">
              {t("gegevens.niveau.volledigWaarschuwing.aan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

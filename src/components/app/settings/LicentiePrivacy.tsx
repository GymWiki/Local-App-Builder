import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { licentieStatus, type LicentieStand } from "@/lib/api";

/** De licentiestand in gewone taal. Zonder licentiesysteem (nu): "Studio is gratis". */
export function LicentieTekst() {
  const { t } = useTranslation();
  const [stand, setStand] = useState<LicentieStand | null>(null);
  useEffect(() => {
    let off = false;
    void Promise.resolve(licentieStatus()).then(
      (s) => !off && setStand(s),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, []);
  return (
    <p className="text-base" data-testid="licentie-tekst">
      {stand?.modus === "betaald" ? t("inst.programma.licentie.betaald", { naam: stand.naam }) : stand?.modus === "gratis_met_melding" ? t("inst.programma.licentie.melding", { reden: t(`inst.programma.licentie.reden.${stand.reden}`, { defaultValue: stand.reden }) }) : t("inst.programma.licentie.gratis")}
    </p>
  );
}

/** Wat er wel en niet naar buiten gaat, in korte zinnen. */
export function PrivacyTekst() {
  const { t } = useTranslation();
  const punten = t("inst.programma.privacy.punten", { returnObjects: true }) as string[];
  return (
    <ul className="list-disc space-y-2 pl-5 text-base" data-testid="privacy-tekst">
      {Array.isArray(punten) && punten.map((p) => <li key={p}>{p}</li>)}
    </ul>
  );
}

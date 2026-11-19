import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateCheck, type UpdateInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import UpdateDialoog from "./UpdateDialoog";

/** In Instellingen: nu zoeken naar een nieuwe versie, met het resultaat in gewone woorden. */
export default function UpdateRij() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [bezig, setBezig] = useState(false);
  const [dialoog, setDialoog] = useState(false);

  async function zoek() {
    setBezig(true);
    try {
      const r = await updateCheck();
      setInfo(r);
      setDialoog(r.status === "beschikbaar");
    } catch {
      setInfo({ status: "fout", versie_nu: "", nieuw: null, notities: null, datum: null });
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" data-testid="update-zoek" disabled={bezig} onClick={() => void zoek()}>
        {bezig ? t("update.zoeken") : t("inst.programma.update.knop")}
      </Button>
      {info && (
        <p className="text-base" data-testid="update-resultaat" data-status={info.status}>
          {t(`update.${info.status}`, { versie: info.versie_nu, nieuw: info.nieuw ?? "" })}
        </p>
      )}
      <UpdateDialoog info={dialoog ? info : null} onClose={() => setDialoog(false)} />
    </div>
  );
}

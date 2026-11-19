import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { projectStorageGet, projectStorageSet } from "@/lib/api";
import Keuze from "@/components/app/settings/Keuze";
import { Button } from "@/components/ui/button";

interface Props {
  projectId: number;
  onKeuze?: (k: "lokaal" | "online" | null) => void;
}

/** "Waar moet je app zijn gegevens bewaren?": alleen op dit apparaat, of online met Supabase. De keuze komt in PROJECT.md. */
export default function OpslagKeuze({ projectId, onKeuze }: Props) {
  const { t } = useTranslation();
  const [keuze, setKeuze] = useState<"lokaal" | "online" | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let weg = false;
    void Promise.resolve(projectStorageGet(projectId))
.then((k) => {
        if (weg) return;
        setKeuze(k ?? null);
        onKeuze?.(k ?? null);
      })
      .catch(() => !weg && setKeuze(null));
    return () => {
      weg = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const kies = async (k: "lokaal" | "online") => {
    try {
      await projectStorageSet(projectId, k);
      setKeuze(k);
      setOpen(false);
      onKeuze?.(k);
      toast.success(t("gegevens.opslag.opgeslagen"));
    } catch {
      /* de keuze blijft zoals ze was */
    }
  };

  if (keuze === undefined) return null;
  if (keuze && !open) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-border p-3" data-testid="opslag-gekozen">
        <p className="min-w-0 flex-1 text-base">{t("gegevens.opslag.gekozen", { keuze: t(`gegevens.opslag.${keuze}.naam`) })}</p>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {t("gegevens.opslag.wijzig")}
        </Button>
      </div>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border-2 border-primary p-4" data-testid="opslag-keuze">
      <h3 className="text-lg font-semibold">{t("gegevens.opslag.titel")}</h3>
      <p className="text-base text-muted-foreground">{t("gegevens.opslag.uitleg")}</p>
      <Keuze
        naam={`opslag-${projectId}`}
        label={t("gegevens.opslag.titel")}
        waarde={(keuze ?? "") as "lokaal"}
        onChange={(v) => void kies(v)}
        opties={(["lokaal", "online"] as const).map((v) => ({ value: v, titel: t(`gegevens.opslag.${v}.naam`), tekst: t(`gegevens.opslag.${v}.uitleg`) }))}
      />
      <p className="text-sm text-muted-foreground">{t("gegevens.opslag.advies")}</p>
    </section>
  );
}

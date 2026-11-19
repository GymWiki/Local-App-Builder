import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheckIcon, ShieldAlertIcon } from "lucide-react";
import { chatSend, supaSecurityCheck } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  projectId: number;
  tick: number;
  /** Alleen zichtbaar als er een koppeling is (anders valt er niets te controleren). */
  actief: boolean;
}

/** Veiligheidscheck van de database in gewone taal (tabellen zonder RLS, te ruime regels), met "Laat de AI dit herstellen". */
export default function Controle({ projectId, tick, actief }: Props) {
  const { t } = useTranslation();
  const [bev, setBev] = useState<{ code: string; tabel: string }[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    if (!actief) return;
    let weg = false;
    void Promise.resolve(supaSecurityCheck(projectId))
.then((r) => {
        if (weg) return;
        if (r.fout) setFout(r.fout);
        else {
          setFout(null);
          setBev(r.bevindingen ?? []);
        }
      })
      .catch(() => !weg && setFout("onverwacht"));
    return () => {
      weg = true;
    };
  }, [projectId, tick, actief]);

  if (!actief) return null;
  if (fout) return null; // een tijdelijke fout (bijvoorbeeld gepauzeerd) wordt al bij de koppeling getoond
  if (bev === null) return <p className="text-sm text-muted-foreground">{t("gegevens.veiligheid.laden")}</p>;
  const ernstig = bev.filter((b) => b.code !== "beleid_alles_leesbaar" || true);
  return (
    <section className="space-y-2" data-testid="db-controle">
      <h3 className="text-lg font-semibold">{t("gegevens.veiligheid.titel")}</h3>
      {ernstig.length === 0 ? (
        <p className="flex items-center gap-2 text-base" role="status">
          <ShieldCheckIcon className="size-5 text-success" aria-hidden="true" />
          {t("gegevens.veiligheid.alleGoed")}
        </p>
      ) : (
        <Alert className="border-warning/50 bg-warning/10">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertDescription className="space-y-2 text-base text-foreground">
            <ul className="list-disc space-y-1 pl-5">
              {ernstig.map((b, i) => (
                <li key={i}>{t(`gegevens.veiligheid.${b.code}`, { tabel: b.tabel, defaultValue: b.tabel })}</li>
              ))}
            </ul>
            <Button
              variant="outline"
              data-testid="db-herstel"
              onClick={() => void chatSend(projectId, t("gegevens.veiligheid.herstelPrompt", { lijst: ernstig.map((b) => `${b.code} (${b.tabel})`).join(", ") })).catch(() => undefined)}
            >
              {t("gegevens.veiligheid.herstel")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

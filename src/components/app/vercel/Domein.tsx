import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, CopyIcon } from "lucide-react";
import { vercelDomainAdd, vercelDomainCheck } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Resultaat {
  naam?: string;
  geverifieerd?: boolean;
  regels?: { type: string; naam: string; waarde: string }[];
  fout?: string;
}

/** Een eigen domeinnaam koppelen die je al hebt. Studio toont wat Vercel zelf vraagt en controleert het. Domeinen kopen kan hier niet. */
export default function Domein({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const [domein, setDomein] = useState("");
  const [res, setRes] = useState<Resultaat | null>(null);
  const [bezig, setBezig] = useState(false);

  async function doe(f: typeof vercelDomainAdd) {
    setBezig(true);
    try {
      setRes(await f(projectId, domein.trim()));
    } catch {
      setRes({ fout: "onverwacht" });
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border-2 border-border p-4" data-testid="vercel-domein" aria-labelledby="vercel-dom-titel">
      <h3 id="vercel-dom-titel" className="text-lg font-semibold">
        {t("vercel.domein.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("vercel.domein.uitleg")}</p>
      <p className="text-sm text-muted-foreground">{t("vercel.domein.kosten")}</p>
      <div className="space-y-2">
        <Label htmlFor="vd-naam" className="text-base">
          {t("vercel.domein.naam")}
        </Label>
        <Input id="vd-naam" value={domein} onChange={(e) => setDomein(e.target.value)} placeholder="mijnwinkel.nl" data-testid="vercel-domein-naam" autoComplete="off" />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button data-testid="vercel-domein-koppel" disabled={bezig || domein.trim().length < 4} onClick={() => void doe(vercelDomainAdd)}>
          {t("vercel.domein.koppel")}
        </Button>
        <Button variant="outline" data-testid="vercel-domein-controleer" disabled={bezig || domein.trim().length < 4} onClick={() => void doe(vercelDomainCheck)}>
          {t("vercel.domein.controleer")}
        </Button>
      </div>
      {res && (
        <Alert role="status" data-testid="vercel-domein-resultaat" className={res.geverifieerd ? "border-success/50 bg-success/10" : "border-warning/50 bg-warning/10"}>
          {res.geverifieerd && <CheckIcon aria-hidden="true" />}
          <AlertDescription className="space-y-2 text-base text-foreground">
            {res.fout ? <p>{t(`vercel.fout.${res.fout}`, { defaultValue: t("vercel.uitkomst.onbekend") })}</p> : res.geverifieerd ? <p>{t("vercel.domein.klaar")}</p> : <p>{t("vercel.domein.nogNiet")}</p>}
            {(res.regels ?? []).length > 0 && (
              <ul className="space-y-1">
                {(res.regels ?? []).map((r) => (
                  <li key={`${r.type}-${r.naam}`} className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    <span>{r.type}</span>
                    <span>{r.naam}</span>
                    <span className="break-all">{r.waarde}</span>
                    <Button size="sm" variant="ghost" aria-label={t("vercel.kopieer")} onClick={() => void navigator.clipboard?.writeText(r.waarde).then(() => toast.success(t("vercel.gekopieerd")), () => undefined)}>
                      <CopyIcon aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {!res.geverifieerd && !res.fout && <p className="text-sm text-muted-foreground">{t("vercel.domein.wachten")}</p>}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

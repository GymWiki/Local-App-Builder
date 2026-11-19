import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, CircleAlertIcon, CircleXIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import { connectOpen, systemCheck, type SysteemPunt, type SysteemRapport } from "@/lib/api";
import { Button } from "@/components/ui/button";

const DOWNLOAD: Partial<Record<SysteemPunt["id"], string>> = { node: "https://nodejs.org/en/download", git: "https://git-scm.com/downloads" };

function Icoon({ status }: { status: SysteemPunt["status"] }) {
  const { t } = useTranslation();
  const l = t(`systeem.status.${status}`);
  if (status === "ok") return <CheckIcon className="size-5 text-success" aria-label={l} />;
  if (status === "let_op") return <CircleAlertIcon className="size-5 text-warning" aria-label={l} />;
  return <CircleXIcon className="size-5 text-destructive" aria-label={l} />;
}

/** De controle van wat Studio nodig heeft, met per punt een uitleg in gewone taal en een knop om het op te lossen. Draait op de achtergrond. */
export default function Systeemcheck({ onRapport }: { onRapport?: (r: SysteemRapport) => void }) {
  const { t } = useTranslation();
  const [rapport, setRapport] = useState<SysteemRapport | null>(null);
  const [bezig, setBezig] = useState(true);
  const alive = useRef(true);

  const draai = useCallback(async () => {
    setBezig(true);
    try {
      const r = await systemCheck();
      if (alive.current && r && Array.isArray(r.punten)) {
        setRapport(r);
        onRapport?.(r);
      }
    } catch {
      /* een mislukte controle blokkeert niets: de gebruiker kan opnieuw proberen */
    } finally {
      if (alive.current) setBezig(false);
    }
  }, [onRapport]);

  useEffect(() => {
    alive.current = true;
    // Eerste controle bij het openen van het scherm.
    void Promise.resolve(systemCheck()).then(
      (r) => {
        if (alive.current && r && Array.isArray(r.punten)) {
          setRapport(r);
          onRapport?.(r);
        }
        if (alive.current) setBezig(false);
      },
      () => alive.current && setBezig(false),
    );
    return () => {
      alive.current = false;
    };
  }, [onRapport]);

  return (
    <section className="space-y-3" data-testid="systeemcheck" aria-labelledby="systeem-titel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="systeem-titel" className="text-lg font-semibold">
          {t("systeem.titel")}
        </h3>
        <Button variant="outline" size="sm" data-testid="systeem-opnieuw" disabled={bezig} onClick={() => void draai()}>
          {bezig ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {bezig ? t("systeem.bezig") : t("systeem.opnieuw")}
        </Button>
      </div>
      {rapport && (
        <>
          <p className="text-base text-muted-foreground" data-testid="systeem-samenvatting" data-klaar={rapport.klaar ? "ja" : "nee"}>
            {rapport.klaar ? (rapport.punten.some((p) => p.status === "let_op") ? t("systeem.let_op") : t("systeem.alles")) : t("systeem.fout")}
          </p>
          <ul className="space-y-2">
            {rapport.punten.map((p) => (
              <li key={p.id} data-punt={p.id} data-status={p.status} className="flex items-start gap-3 text-base">
                <span className="mt-0.5">
                  <Icoon status={p.status} />
                </span>
                <span className="flex-1">
                  <span className="font-medium">{t(`systeem.punt.${p.id}.titel`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`systeem.punt.${p.id}.${p.status}`, { detail: p.detail ?? "", defaultValue: "" })}</span>
                  {p.status !== "ok" && (
                    <>
                      <span className="block text-sm">{t(`systeem.punt.${p.id}.oplossing`, { defaultValue: "" })}</span>
                      {DOWNLOAD[p.id] && (
                        <Button variant="outline" size="sm" className="mt-1" data-testid={`systeem-open-${p.id}`} onClick={() => void Promise.resolve(connectOpen(DOWNLOAD[p.id]!)).catch(() => undefined)}>
                          <ExternalLinkIcon aria-hidden="true" />
                          {t(`systeem.open.${p.id}`)}
                        </Button>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

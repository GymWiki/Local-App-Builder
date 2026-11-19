import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangleIcon, DatabaseBackupIcon, ShieldAlertIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { supaConfirmAnswer, type SupaConfirm } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** De uitleg van één verandering in gewone woorden (nl.json: gegevens.wijziging.<code>). */
export function wijzigingTekst(t: TFunction, c: { code: string; params: Record<string, string> }): string {
  return t(`gegevens.wijziging.${c.code}`, { ...c.params, defaultValue: t("gegevens.wijziging.onbekend") });
}

/**
 * De bevestigingsdialoog voor database-acties. Hij staat altijd in de Studio-UI (nooit in het gesprek met de AI) en toont in gewone taal
 * wat er verandert, wat het gevolg is, of er een back-up is en wat het kost. Kosten en gevaarlijke acties krijgen een extra waarschuwing.
 */
export default function BevestigDialoog() {
  const { t } = useTranslation();
  const [wachtrij, setWachtrij] = useState<SupaConfirm[]>([]);

  useEffect(() => {
    let weg = false;
    let off: (() => void) | undefined;
    void listen<SupaConfirm>("db-confirm", (e) => setWachtrij((w) => [...w, e.payload]))
      .then((u) => {
        if (weg) u();
        else off = u;
      })
      .catch(() => undefined);
    return () => {
      weg = true;
      off?.();
    };
  }, []);

  const antwoord = useCallback((id: string, toestaan: boolean) => {
    setWachtrij((w) => w.filter((x) => x.id !== id));
    void supaConfirmAnswer(id, toestaan).catch(() => undefined);
  }, []);

  const q = wachtrij[0];
  if (!q) return null;
  const kosten = q.class === 4 || !!q.kosten;
  const titel = kosten ? t("gegevens.vraag.titelKosten") : q.actor === "gebruiker" ? t("gegevens.vraag.titelGebruiker") : t("gegevens.vraag.titelAi");
  const gevaar = q.class === 3 || q.verlies;
  return (
    // Sluiten (Escape of buiten klikken) telt als "Niet toestaan": zonder duidelijk ja gebeurt er niets.
    <Dialog open onOpenChange={(o) => !o && antwoord(q.id, false)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="bevestig-dialoog" aria-describedby="bevestig-uitleg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {gevaar || kosten ? <AlertTriangleIcon className="size-6 text-warning" aria-hidden="true" /> : null}
            {titel}
          </DialogTitle>
          <DialogDescription id="bevestig-uitleg">{t("gegevens.vraag.uitleg")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {q.uitleg && (
            <p className="rounded-lg bg-muted p-3 text-base" data-testid="bevestig-ai-uitleg">
              <span className="font-semibold">{t("gegevens.vraag.uitlegAi")}</span> {q.uitleg}
            </p>
          )}
          <div>
            <p className="mb-1 font-semibold">{t("gegevens.vraag.wijzigingen")}</p>
            <ul className="list-disc space-y-1 pl-5 text-base" data-testid="bevestig-wijzigingen">
              {q.changes.map((c, i) => (
                <li key={i}>{wijzigingTekst(t, c)}</li>
              ))}
            </ul>
          </div>

          {q.verlies && (
            <Alert variant="destructive" data-testid="bevestig-verlies">
              <ShieldAlertIcon aria-hidden="true" />
              <AlertDescription className="space-y-1">
                <p className="font-semibold">{t("gegevens.vraag.verlies")}</p>
                {q.rijen != null && <p>{t("gegevens.vraag.rijen", { aantal: q.rijen })}</p>}
              </AlertDescription>
            </Alert>
          )}
          {q.class === 3 && q.backup !== "niet_nodig" && (
            <p className={`flex items-start gap-2 text-base ${q.backup === "mislukt" ? "font-semibold text-destructive" : "text-muted-foreground"}`} data-testid={`bevestig-backup-${q.backup}`}>
              <DatabaseBackupIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              {q.backup === "gemaakt" ? t("gegevens.vraag.backupGemaakt") : t("gegevens.vraag.backupMislukt")}
            </p>
          )}
          {q.kosten && (
            <Alert data-testid="bevestig-kosten" className="border-warning/50 bg-warning/10">
              <AlertDescription className="text-base text-foreground">{t(`gegevens.vraag.kosten.${q.kosten.plan}`, { bedrag: q.kosten.per_maand ?? 0 })}</AlertDescription>
            </Alert>
          )}
          {q.waarschuwingen.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {q.waarschuwingen.map((w, i) => (
                <li key={i}>{t(`gegevens.vraag.waarschuwingen.${w.code}`, { tabel: w.tabel ?? "", defaultValue: "" })}</li>
              ))}
            </ul>
          )}
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold">{t("gegevens.vraag.redenenTitel")}</p>
            <ul className="list-disc pl-5">
              {q.redenen.map((r) => (
                <li key={r}>{t(`gegevens.vraag.reden.${r}`, { defaultValue: r })}</li>
              ))}
            </ul>
          </div>
          {q.sql && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="link" className="h-auto px-0">
                  {t("gegevens.vraag.sql")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{q.sql}</pre>
              </CollapsibleContent>
            </Collapsible>
          )}
          {wachtrij.length > 1 && <p className="text-sm text-muted-foreground">{t("gegevens.vraag.wachtend", { aantal: wachtrij.length - 1 })}</p>}
        </div>

        <DialogFooter>
          {/* "Niet toestaan" is de standaardkeuze (focus), zodat een onbedoelde Enter niets uitvoert. */}
          <Button autoFocus variant="outline" onClick={() => antwoord(q.id, false)} data-testid="bevestig-nee">
            {t("gegevens.vraag.nietToestaan")}
          </Button>
          <Button variant={gevaar || kosten ? "destructive" : "default"} onClick={() => antwoord(q.id, true)} data-testid="bevestig-ja">
            {t("gegevens.vraag.toestaan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeftIcon, DatabaseIcon, TableIcon } from "lucide-react";
import { chatSend, dataOverview, dataRows, type DataFile, type TableRows } from "@/lib/api";
import { listen } from "@tauri-apps/api/event";
import ActieLog from "@/components/app/supabase/ActieLog";
import Controle from "@/components/app/supabase/Controle";
import InloggenKeuze from "@/components/app/supabase/InloggenKeuze";
import Gebruikers from "@/components/app/supabase/Gebruikers";
import NiveauKiezer from "@/components/app/supabase/NiveauKiezer";
import OpslagKeuze from "@/components/app/supabase/OpslagKeuze";
import SupabaseKoppeling from "@/components/app/supabase/SupabaseKoppeling";
import Tabellen from "@/components/app/supabase/Tabellen";
import { useSupa } from "@/components/app/supabase/use-supa";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "../workspace-context";
import EmptyState from "./EmptyState";
import Frame from "./Frame";

/** Wat de app onthoudt: een overzicht van de gegevensbestanden (alleen lezen) met de eerste rijen van elke tabel. */
function LokaalOverzicht() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [bestanden, setBestanden] = useState<DataFile[] | null>(null);
  const [open, setOpen] = useState<{ bestand: string; tabel: string; rijen: TableRows } | null>(null);

  useEffect(() => {
    let off = false;
    dataOverview(w.project.id)
      .then((d) => !off && setBestanden(d))
      .catch(() => !off && setBestanden([]));
    return () => {
      off = true;
    };
  }, [w.project.id, w.tick]);

  async function kijk(bestand: string, tabel: string) {
    try {
      setOpen({ bestand, tabel, rijen: await dataRows(w.project.id, bestand, tabel, 50) });
    } catch (e) {
      w.onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }

  async function vraag() {
    try {
      await chatSend(w.project.id, t("gegevens.prompt"));
      toast.success(t("gegevens.verstuurd"));
    } catch (e) {
      w.onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }

  const leeg = bestanden && bestanden.length === 0;

  return (
    <>
      {w.signals?.needs_data && w.signals.needs_data_reden && (
        <Alert role="status" data-testid="gegevens-nodig" className="border-warning/50 bg-warning/10">
          <AlertDescription className="text-base text-foreground">{t("gegevens.nodig", { reden: w.signals.needs_data_reden })}</AlertDescription>
        </Alert>
      )}
      {open ? (
        <div className="space-y-3" data-testid="gegevens-tabel">
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
            <ArrowLeftIcon aria-hidden="true" />
            {t("gegevens.terug")}
          </Button>
          <h3 className="text-lg font-semibold">{open.tabel}</h3>
          <p className="text-sm text-muted-foreground">{t("gegevens.eerste", { aantal: open.rijen.rijen.length, totaal: open.rijen.totaal })}</p>
          <Table>
            <TableHeader>
              <TableRow>
                {open.rijen.kolommen.map((k) => (
                  <TableHead key={k}>{k}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.rijen.rijen.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} className="max-w-48 truncate" title={c}>
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">{t("gegevens.alleenLezen")}</p>
        </div>
      ) : (
        <>
          {(bestanden ?? []).map((b) => (
            <section key={b.bestand} className="space-y-2" aria-label={b.bestand}>
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <DatabaseIcon aria-hidden="true" className="size-5" />
                {b.bestand}
              </h3>
              <ul className="space-y-2">
                {b.tabellen.map((tb) => (
                  <li key={tb.naam}>
                    <Button variant="outline" className="w-full justify-start gap-3" aria-label={t("gegevens.bekijk", { naam: tb.naam })} onClick={() => void kijk(b.bestand, tb.naam)}>
                      <TableIcon aria-hidden="true" />
                      <span className="flex-1 text-left font-semibold">{tb.naam}</span>
                      <span className="text-sm font-normal text-muted-foreground">{t("gegevens.rijen", { aantal: tb.rijen })}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {leeg && <EmptyState icon={<DatabaseIcon className="size-10" />} titel={t("gegevens.leeg.titel")} uitleg={w.signals?.heeft_database ? t("gegevens.geenBestand") : t("gegevens.leeg.uitleg")} knop={t("gegevens.leeg.knop")} onKnop={() => void vraag()} />}
        </>
      )}
    </>
  );
}

/** Wat je app onthoudt: de keuze van de opslag, de koppeling met Supabase (met niveau en vangnet) en de lokale gegevens. */
export default function GegevensPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const { state } = useSupa(w.project.id);
  const [keuze, setKeuze] = useState<"lokaal" | "online" | null>(null);
  const [tick, setTick] = useState(0);
  // Elke wijziging in de database (of het log) ververst de lijsten.
  useEffect(() => {
    let off: (() => void) | undefined;
    let weg = false;
    void listen<{ project_id: number }>("supa-changed", (e) => e.payload?.project_id === w.project.id && setTick((n) => n + 1))
      .then((u) => (weg ? u() : (off = u)))
      .catch(() => undefined);
    return () => {
      weg = true;
      off?.();
    };
  }, [w.project.id]);
  const online = keuze === "online" || state.gekoppeld;
  return (
    <Frame titel={t("gegevens.titel")} uitleg={t("gegevens.uitleg")}>
      <OpslagKeuze projectId={w.project.id} onKeuze={setKeuze} />
      {(online || keuze === null) && <SupabaseKoppeling projectId={w.project.id} />}
      {state.gekoppeld && (
        <>
          <NiveauKiezer projectId={w.project.id} />
          <Controle projectId={w.project.id} tick={tick} actief />
          <Tabellen projectId={w.project.id} tick={tick + w.tick} />
          <Gebruikers projectId={w.project.id} />
          <InloggenKeuze projectId={w.project.id} />
          <ActieLog projectId={w.project.id} tick={tick} />
        </>
      )}
      {keuze !== "online" && !state.gekoppeld && <LokaalOverzicht />}
    </Frame>
  );
}

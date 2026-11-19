import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, PencilIcon, PlusIcon, TableIcon } from "lucide-react";
import { toast } from "sonner";
import { supaRowSave, supaRows, supaTables, type SupaRows, type SupaTable } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  projectId: number;
  /** Verandert na een wijziging of een melding van Rust, zodat de lijst ververst. */
  tick: number;
}

/** Overzicht van de tabellen met aantallen, een eenvoudige tabelweergave met pagina's en rijen toevoegen of wijzigen (met bevestiging). */
export default function Tabellen({ projectId, tick }: Props) {
  const { t } = useTranslation();
  const [tabellen, setTabellen] = useState<SupaTable[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [rijen, setRijen] = useState<(SupaRows & { fout?: string }) | null>(null);
  const [bewerk, setBewerk] = useState<{ rij: string[] | null } | null>(null);

  useEffect(() => {
    let weg = false;
    void Promise.resolve(supaTables(projectId))
.then((r) => {
        if (weg) return;
        if (r.fout) setFout(r.fout);
        else {
          setFout(null);
          setTabellen(r.tabellen ?? []);
        }
      })
      .catch(() => !weg && setFout("onverwacht"));
    return () => {
      weg = true;
    };
  }, [projectId, tick]);

  const [vers, setVers] = useState(0);
  useEffect(() => {
    if (!open) return;
    let weg = false;
    void Promise.resolve(supaRows(projectId, open, pagina))
.then((r) => !weg && setRijen(r))
      .catch(() => !weg && setRijen({ kolommen: [], rijen: [], meer: false, pagina, fout: "onverwacht" }));
    return () => {
      weg = true;
    };
  }, [projectId, open, pagina, tick, vers]);

  if (fout) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{fout}</AlertDescription>
      </Alert>
    );
  }
  if (tabellen === null) return null;

  if (open) {
    const kol = rijen?.kolommen ?? [];
    return (
      <div className="space-y-3" data-testid="tabel-rijen">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(null);
            setRijen(null);
            setPagina(0);
          }}
        >
          <ArrowLeftIcon aria-hidden="true" />
          {t("gegevens.tabellen.terug")}
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex-1 text-lg font-semibold">{open}</h3>
          <Button variant="outline" onClick={() => setBewerk({ rij: null })} data-testid="rij-toevoegen">
            <PlusIcon aria-hidden="true" />
            {t("gegevens.tabellen.rijToevoegen")}
          </Button>
        </div>
        {rijen?.fout && (
          <Alert variant="destructive">
            <AlertDescription>{rijen.fout}</AlertDescription>
          </Alert>
        )}
        {rijen && !rijen.fout && rijen.rijen.length === 0 && <p className="text-base text-muted-foreground">{t("gegevens.tabellen.leeg")}</p>}
        {rijen && rijen.rijen.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                {kol.map((k) => (
                  <TableHead key={k}>{k}</TableHead>
                ))}
                <TableHead>
                  <span className="sr-only">{t("gegevens.tabellen.wijzig")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rijen.rijen.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} className="max-w-48 truncate" title={c}>
                      {c}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Button variant="ghost" size="icon" aria-label={t("gegevens.tabellen.wijzig")} onClick={() => setBewerk({ rij: r })}>
                      <PencilIcon aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))}>
            {t("gegevens.tabellen.vorige")}
          </Button>
          <span className="text-sm text-muted-foreground">{t("gegevens.tabellen.pagina", { nu: pagina + 1 })}</span>
          <Button variant="outline" size="sm" disabled={!rijen?.meer} onClick={() => setPagina((p) => p + 1)}>
            {t("gegevens.tabellen.volgende")}
          </Button>
        </div>
        {bewerk && (
          <RijDialoog
            tabel={open}
            kolommen={kol}
            rij={bewerk.rij}
            onClose={() => setBewerk(null)}
            onSave={async (waarden) => {
              const sleutel = bewerk.rij ? Object.fromEntries(kol.map((k, i) => [k, bewerk.rij![i]])) : null;
              try {
                const r = await supaRowSave(projectId, open, sleutel, waarden);
                if (r.status === "uitgevoerd") {
                  toast.success(t("gegevens.log.status.uitgevoerd", { defaultValue: "Uitgevoerd" }));
                  setVers((n) => n + 1);
                } else if (r.tekst) toast.error(r.tekst);
              } catch (e) {
                toast.error(String(e));
              }
              setBewerk(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="tabellen">
      <h3 className="text-lg font-semibold">{t("gegevens.tabellen.titel")}</h3>
      {tabellen.length === 0 && <p className="text-base text-muted-foreground">{t("gegevens.tabellen.geen")}</p>}
      <ul className="space-y-2">
        {tabellen.map((tb) => (
          <li key={tb.tabel}>
            <Button
              variant="outline"
              className="h-auto w-full justify-start gap-3 py-3"
              aria-label={t("gegevens.bekijk", { naam: tb.tabel })}
              onClick={() => {
                setPagina(0);
                setOpen(tb.tabel);
              }}
            >
              <TableIcon aria-hidden="true" />
              <span className="flex-1 text-left font-semibold">{tb.tabel}</span>
              <Badge variant={tb.rls ? "secondary" : "destructive"}>{tb.rls ? t("gegevens.tabellen.rlsAan") : t("gegevens.tabellen.rlsUit")}</Badge>
              <span className="text-sm font-normal text-muted-foreground">{tb.rijen != null ? t("gegevens.tabellen.aantal", { aantal: tb.rijen }) : ""}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RijDialoog({ tabel, kolommen, rij, onClose, onSave }: { tabel: string; kolommen: string[]; rij: string[] | null; onClose: () => void; onSave: (w: Record<string, string | null>) => void }) {
  const { t } = useTranslation();
  const [waarden, setWaarden] = useState<Record<string, string>>(() => Object.fromEntries(kolommen.map((k, i) => [k, rij?.[i] ?? ""])));
  const gewijzigd = Object.fromEntries(kolommen.filter((k, i) => waarden[k] !== (rij?.[i] ?? "")).map((k) => [k, waarden[k] === "" ? null : waarden[k]]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="rij-dialoog" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tabel}</DialogTitle>
          <DialogDescription>{t("gegevens.tabellen.opslaanUitleg")}</DialogDescription>
        </DialogHeader>
        {kolommen.map((k) => (
          <Field key={k}>
            <FieldLabel htmlFor={`rij-${k}`}>{k}</FieldLabel>
            <Input id={`rij-${k}`} value={waarden[k] ?? ""} onChange={(e) => setWaarden((w) => ({ ...w, [k]: e.target.value }))} />
          </Field>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("gegevens.tabellen.annuleer")}
          </Button>
          <Button disabled={Object.keys(gewijzigd).length === 0} onClick={() => onSave(gewijzigd)} data-testid="rij-bewaar">
            {t("gegevens.tabellen.bewaar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supaUsers } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** De mensen die zich bij de app hebben aangemeld (alleen e-mail en data; nooit wachtwoorden). Wordt pas opgehaald als je erom vraagt. */
export default function Gebruikers({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const [lijst, setLijst] = useState<Record<string, string | null>[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const datum = (s: string | null) => (s ? new Date(s).toLocaleString("nl-NL") : "—");
  return (
    <section className="space-y-2" data-testid="gebruikers">
      <h3 className="text-lg font-semibold">{t("gegevens.gebruikers.titel")}</h3>
      <p className="text-base text-muted-foreground">{t("gegevens.gebruikers.uitleg")}</p>
      {lijst === null ? (
        <Button
          variant="outline"
          onClick={() =>
            void Promise.resolve(supaUsers(projectId))
.then((r) => {
              if (r.fout) setFout(r.fout);
              else setLijst(r.gebruikers ?? []);
            })
          }
        >
          {t("gegevens.gebruikers.titel")}
        </Button>
      ) : lijst.length === 0 ? (
        <p className="text-base">{t("gegevens.gebruikers.geen")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("gegevens.gebruikers.email")}</TableHead>
              <TableHead>{t("gegevens.gebruikers.sinds")}</TableHead>
              <TableHead>{t("gegevens.gebruikers.laatst")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lijst.map((u, i) => (
              <TableRow key={u.id ?? i}>
                <TableCell>{u.email ?? "—"}</TableCell>
                <TableCell>{datum(u.created_at)}</TableCell>
                <TableCell>{datum(u.last_sign_in_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {fout && <p className="text-sm text-destructive">{fout}</p>}
    </section>
  );
}

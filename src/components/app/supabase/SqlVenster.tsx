import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supaSql, type SupaReply } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useSupa } from "./use-supa";

/** Vrije SQL, alleen onder "Voor gevorderden". Lezen is vrij; wat iets verandert vraagt altijd eerst een bevestiging in een dialoog. */
export default function SqlVenster({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { state } = useSupa(projectId);
  const [sql, setSql] = useState("");
  const [uit, setUit] = useState<SupaReply | null>(null);
  const [bezig, setBezig] = useState(false);
  if (!state.gekoppeld) return null;
  return (
    <Card data-testid="sql-venster">
      <CardHeader>
        <CardTitle className="text-lg">{t("gegevens.sql.titel")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-base text-muted-foreground">{t("gegevens.sql.uitleg")}</p>
        <Textarea value={sql} rows={5} className="font-mono text-sm" aria-label={t("gegevens.sql.titel")} placeholder={t("gegevens.sql.plaats")} onChange={(e) => setSql(e.target.value)} />
        <Button
          disabled={!sql.trim() || bezig}
          onClick={() => {
            setBezig(true);
            void Promise.resolve(supaSql(projectId, sql))
.then(setUit)
              .catch((e) => setUit({ status: "mislukt", tekst: String(e) }))
              .finally(() => setBezig(false));
          }}
        >
          {t("gegevens.sql.voer")}
        </Button>
        {uit && (
          <div className="space-y-1" data-testid="sql-uitkomst">
            <p className={`text-base ${uit.status === "uitgevoerd" ? "" : "text-destructive"}`}>{uit.tekst}</p>
            {uit.data !== undefined && uit.data !== null && <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{JSON.stringify(uit.data, null, 2)}</pre>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useTranslation } from "react-i18next";
import { previewRestart } from "@/lib/api";
import McpProblem from "@/components/McpProblem";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

function Rij({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base break-words">{children}</dd>
    </div>
  );
}

/** De technische toestand van de AI-koppeling (MCP) en van de dev-server, met knoppen om opnieuw te proberen. Alleen voor gevorderden. */
export default function StatusPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const m = w.mcp;
  const p = w.preview;
  return (
    <Frame titel={t("technisch.titel")} uitleg={t("technisch.uitleg")}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("technisch.koppeling.titel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-2" data-testid="status-koppeling">
            <Rij label={t("technisch.koppeling.toestand")}>{m ? t(`mcp.${m.state}`) : t("mcp.uit")}</Rij>
            <Rij label={t("technisch.koppeling.poort")}>{m?.port ?? t("technisch.geen")}</Rij>
            <Rij label={t("technisch.koppeling.fout")}>{m?.error ?? t("technisch.geen")}</Rij>
          </dl>
          {m?.state === "unavailable" && <McpProblem info={m} onRetry={() => void w.onRetryMcp()} />}
          <Button variant="outline" onClick={() => void w.onRetryMcp()}>
            {t("technisch.opnieuwKoppeling")}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("technisch.voorbeeld.titel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-2" data-testid="status-voorbeeld">
            <Rij label={t("technisch.voorbeeld.toestand")}>{t(`preview.status.${p?.status ?? "idle"}`)}</Rij>
            <Rij label={t("technisch.voorbeeld.soort")}>{p?.mode ?? t("technisch.geen")}</Rij>
            <Rij label={t("technisch.voorbeeld.adres")}>{p?.url ?? t("technisch.geen")}</Rij>
            <Rij label={t("technisch.voorbeeld.probleem")}>{p?.problem?.message ?? t("technisch.geen")}</Rij>
          </dl>
          <Button variant="outline" onClick={() => void previewRestart(w.project.id).catch((e) => w.onError(t("fout.algemeen", { bericht: String(e) })))}>
            {t("technisch.opnieuwVoorbeeld")}
          </Button>
        </CardContent>
      </Card>
    </Frame>
  );
}

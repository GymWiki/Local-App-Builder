import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { runtime } from "@/lib/api";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

/** Meldingen van het voorbeeld (dev-server) en van de AI-koppeling. Alleen voor gevorderden. */
export default function LogsPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [dev, setDev] = useState<string[]>([]);
  const up = w.mcp?.state === "running" || w.mcp?.state === "connected";
  useEffect(() => {
    if (!up) return;
    let off = false;
    const laad = () =>
      runtime<string[]>(w.project.id, "dev.logs", { lines: 200 })
        .then((l) => !off && setDev(l))
        .catch(() => undefined);
    void laad();
    const timer = setInterval(laad, 2500);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [w.project.id, up]);
  const koppeling = w.mcp?.log ?? [];
  return (
    <Frame titel={t("logs.titel")} uitleg={t("logs.uitleg")}>
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{t("logs.voorbeeld")}</h3>
        <pre data-testid="logs-voorbeeld" className="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">
          {dev.length ? dev.join("\n") : t("logs.leeg")}
        </pre>
      </section>
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{t("logs.koppeling")}</h3>
        <pre data-testid="logs-koppeling" className="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">
          {koppeling.length ? koppeling.join("\n") : t("logs.leeg")}
        </pre>
      </section>
    </Frame>
  );
}

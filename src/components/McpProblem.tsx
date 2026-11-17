import { useTranslation } from "react-i18next";
import type { McpInfo } from "../lib/api";

interface Props {
  info: McpInfo | null;
  busy?: boolean;
  onRetry: () => void;
}

/** Toont de echte reden dat de MCP-server niet draait, met laatste logregels en een knop om opnieuw te proberen. */
export default function McpProblem({ info, busy = false, onRetry }: Props) {
  const { t } = useTranslation();
  const kind = info?.kind ?? null;
  return (
    <div role="alert" data-testid="mcp-problem" className="space-y-2 border-b border-destructive bg-destructive/10 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-destructive">{t("mcp.probleemTitel")}</div>
          <div className="break-words text-destructive">{info?.error ?? t("mcp.nietGestart")}</div>
          {kind && <div className="text-muted-foreground">{t(`mcp.hint.${kind}`)}</div>}
        </div>
        <button
          onClick={onRetry}
          disabled={busy}
          className="shrink-0 rounded bg-primary text-primary-foreground px-3 py-1.5 font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? t("mcp.bezig") : t("mcp.opnieuw")}
        </button>
      </div>
      {info?.log && info.log.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("mcp.logs")}</summary>
          <pre data-testid="mcp-log" className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs text-muted-foreground">
            {info.log.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}

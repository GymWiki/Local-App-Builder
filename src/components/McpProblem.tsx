import { useTranslation } from "react-i18next";
import { ChevronDownIcon, CircleAlertIcon } from "lucide-react";
import type { McpInfo } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
    <Alert
      variant="destructive"
      data-testid="mcp-problem"
      className="rounded-none border-0 border-b border-destructive/50 bg-destructive/10"
    >
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle className="font-semibold">
        {t("mcp.probleemTitel")}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="break-words text-destructive">
              {kind ? t(`mcp.hint.${kind}`) : t("mcp.nietGestart")}
            </div>
          </div>
          <Button
            onClick={onRetry}
            disabled={busy}
            size="sm"
            className="shrink-0"
          >
            {busy ? t("mcp.bezig") : t("mcp.opnieuw")}
          </Button>
        </div>
        {(info?.error || (info?.log && info.log.length > 0)) && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="px-0">
                {t("mcp.logs")}
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent forceMount>
              <pre
                data-testid="mcp-log"
                className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground"
              >
                {[info?.error, ...(info?.log ?? [])].filter(Boolean).join("\n")}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}

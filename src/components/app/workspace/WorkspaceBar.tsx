import { useTranslation } from "react-i18next";
import {
  LayoutPanelLeftIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
} from "lucide-react";
import type { McpInfo, PreviewInfo } from "@/lib/api";
import { PRESETS, type PresetId } from "@/lib/layout";
import { useSupa } from "@/components/app/supabase/use-supa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  projectId: number;
  mcp: McpInfo | null;
  preview: PreviewInfo | null;
  maximized: boolean;
  onPreset: (p: PresetId) => void;
  onReset: () => void;
  onToggleMaximize: () => void;
  onCloseProject: () => void;
  onShortcuts: () => void;
}

const PREVIEW_TOON: Record<string, string> = {
  running: "border-transparent bg-success/15 text-success",
  starting: "border-transparent bg-accent text-accent-foreground",
  stopping: "border-transparent bg-warning/20 text-warning",
  error: "border-transparent bg-destructive/15 text-destructive",
  idle: "border-transparent bg-muted text-muted-foreground",
};
const MCP_TOON: Record<string, string> = {
  connected: "border-transparent bg-success/15 text-success",
  running: "border-transparent bg-success/15 text-success",
  starting: "border-transparent bg-accent text-accent-foreground",
  unavailable: "border-transparent bg-destructive/15 text-destructive",
  uit: "border-transparent bg-muted text-muted-foreground",
};

/** Bovenbalk van de werkruimte: status van voorbeeld en AI-koppeling en het indelingsmenu. (Terug en projectnaam staan bovenaan het menu.) */
export default function WorkspaceBar({
  projectId,
  mcp,
  preview,
  maximized,
  onPreset,
  onReset,
  onToggleMaximize,
  onCloseProject,
  onShortcuts,
}: Props) {
  const { t } = useTranslation();
  const { state: supa } = useSupa(projectId);
  const pStatus = preview?.status ?? "idle";
  const mStatus = mcp?.state ?? "uit";
  const mTekst = {
    connected: "mcpVerbonden",
    running: "mcpGereed",
    starting: "mcpStart",
    unavailable: "mcpProbleem",
    uit: "mcpUit",
  }[mStatus];
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex-1" />
      <div
        role="group"
        aria-label={t("werkruimte.balk.status")}
        className="flex items-center gap-2"
      >
        <Badge
          data-testid="status-preview"
          className={PREVIEW_TOON[pStatus] ?? PREVIEW_TOON.idle}
        >
          {t("werkruimte.balk.preview", {
            status: t(`preview.status.${pStatus}`),
          })}
        </Badge>
        {supa.gekoppeld && (
          <Badge data-testid="status-niveau" className={supa.niveau === "volledig" ? "border-transparent bg-destructive text-destructive-foreground" : "border-transparent bg-muted text-muted-foreground"}>
            {t("gegevens.niveau.balkKort", { niveau: t(`gegevens.niveau.${supa.niveau}.naam`) })}
          </Badge>
        )}
        <Badge data-testid="status-mcp" className={MCP_TOON[mStatus]}>
          {t("werkruimte.balk.mcp", { status: t(`werkruimte.balk.${mTekst}`) })}
        </Badge>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-label={t("werkruimte.balk.indelingMenu")}
          >
            <LayoutPanelLeftIcon aria-hidden="true" />
            {t("werkruimte.balk.indeling")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>{t("werkruimte.balk.indeling")}</DropdownMenuLabel>
          {PRESETS.map((p) => (
            <DropdownMenuItem key={p} onSelect={() => onPreset(p)}>
              {t(`werkruimte.balk.${p}`)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onToggleMaximize}>
            {maximized
              ? t("werkruimte.balk.herstelGrootte")
              : t("werkruimte.balk.maximaliseer")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onReset}>
            <RotateCcwIcon aria-hidden="true" />
            {t("werkruimte.balk.herstel")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("werkruimte.balk.meer")}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onShortcuts}>{t("werkruimte.balk.sneltoetsen")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCloseProject}>
            {t("werkruimte.balk.sluitProject")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

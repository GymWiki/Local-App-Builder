import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  LayoutPanelLeftIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
} from "lucide-react";
import type { McpInfo, PreviewInfo } from "@/lib/api";
import { PRESETS, type PresetId } from "@/lib/layout";
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
  naam: string;
  mcp: McpInfo | null;
  preview: PreviewInfo | null;
  maximized: boolean;
  onHome: () => void;
  onPreset: (p: PresetId) => void;
  onReset: () => void;
  onToggleMaximize: () => void;
  onCloseProject: () => void;
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

/** Bovenbalk van de werkruimte: terug naar alle projecten, de naam, de status van voorbeeld en AI-koppeling, en het indelingsmenu. */
export default function WorkspaceBar({
  naam,
  mcp,
  preview,
  maximized,
  onHome,
  onPreset,
  onReset,
  onToggleMaximize,
  onCloseProject,
}: Props) {
  const { t } = useTranslation();
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
      <Button variant="ghost" onClick={onHome}>
        <ArrowLeftIcon aria-hidden="true" />
        {t("home.alleProjecten")}
      </Button>
      <h1
        className="min-w-0 flex-1 truncate text-lg font-semibold"
        title={naam}
      >
        {naam}
      </h1>
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
          <DropdownMenuItem onSelect={onCloseProject}>
            {t("werkruimte.balk.sluitProject")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

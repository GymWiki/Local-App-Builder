import type { McpInfo, Project } from "@/lib/api";
import ActivityPanel from "@/components/ActivityPanel";
import { useTranslation } from "react-i18next";
import VerbindKnop from "@/components/app/connect/VerbindKnop";
import { useWorkspace } from "../workspace-context";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  project: Project;
  mcp: McpInfo | null;
  tick: number;
  onError: (msg: string) => void;
}

/** Laatste controle en eerdere versies (met terugzetten). */
export default function HistoryPanel({ project, mcp, tick, onError }: Props) {
  const { t } = useTranslation();
  const w = useWorkspace();
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        <section className="mb-5 space-y-2 rounded-xl border-2 border-border p-4" data-testid="versies-koppeling">
          <h3 className="text-lg font-semibold">{t("koppelingen.plek.backupTitel")}</h3>
          <p className="text-base text-muted-foreground">{t("koppelingen.plek.backup")}</p>
          <VerbindKnop id="github" />
        </section>
        <ActivityPanel
          project={project}
          mcp={mcp}
          tick={tick}
          onError={onError}
          onLeegActie={w.focusGesprek}
        />
      </div>
    </ScrollArea>
  );
}

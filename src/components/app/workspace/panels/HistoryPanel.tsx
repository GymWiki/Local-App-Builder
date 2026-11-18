import type { McpInfo, Project } from "@/lib/api";
import ActivityPanel from "@/components/ActivityPanel";
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
  const w = useWorkspace();
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
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

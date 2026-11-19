import { createContext, useContext, type RefObject } from "react";
import type { Account, McpInfo, PreviewInfo, Project, ProjectFlagKey, ProjectSignals } from "@/lib/api";
import type { PanelId } from "@/lib/layout";
import type { Signalen } from "@/lib/menu";
import type { PreviewControl } from "./pick";

/** Wat de panelen van de werkruimte van elkaar en van het project moeten weten. */
export interface WorkspaceCtx {
  project: Project;
  accounts: Account[];
  mcp: McpInfo | null;
  preview: PreviewInfo | null;
  tick: number;
  signalen: Signalen;
  /** Ruwe signalen uit het project (reden van needs_data enzovoort). */
  signals: ProjectSignals | null;
  vlaggen: Record<string, string>;
  /** Haalt de signalen opnieuw op (bijvoorbeeld na het toevoegen van een foto). */
  verversSignalen: () => void;
  setVlag: (key: ProjectFlagKey, value: string | null) => Promise<void>;
  openPaneel: (id: PanelId) => void;
  /** Zet de cursor in het invoerveld van het gesprek (opent het gesprek als dat nodig is). */
  focusGesprek: () => void;
  control: RefObject<PreviewControl | null>;
  onError: (msg: string) => void;
  onRetryMcp: () => Promise<void> | void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);
export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): WorkspaceCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkspace buiten een werkruimte");
  return c;
}

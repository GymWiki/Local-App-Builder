import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account, McpInfo, Project } from "../lib/api";
import TerminalPanel, { type Session } from "./TerminalPanel";

const TABS = ["terminal", "preview", "publiceren"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  project: Project | null;
  accounts?: Account[];
  sessions?: Session[];
  mcp?: McpInfo | null;
  onSessionsChange?: (updater: (prev: Session[]) => Session[]) => void;
  onError?: (msg: string) => void;
}

export default function Workspace({ project, accounts = [], sessions = [], mcp = null, onSessionsChange, onError }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("terminal");

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex gap-1 border-b border-zinc-800 px-3 pt-2">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-t px-4 py-2 text-sm ${
              tab === id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>
      {!project ? (
        <div role="tabpanel" className="flex flex-1 items-center justify-center text-zinc-500">
          {t("tabs.geenProject")}
        </div>
      ) : (
        <>
          {/* Blijft gemount (verborgen) zodat lopende terminals hun scrollback houden. */}
          <div role="tabpanel" className={`min-h-0 flex-1 flex-col ${tab === "terminal" ? "flex" : "hidden"}`}>
            <TerminalPanel
              key={project.id}
              project={project}
              accounts={accounts}
              sessions={sessions}
              mcp={mcp}
              onSessionsChange={onSessionsChange ?? (() => undefined)}
              onError={onError ?? (() => undefined)}
            />
          </div>
          {tab !== "terminal" && (
            <div role="tabpanel" className="flex flex-1 items-center justify-center text-zinc-500">
              {t("tabs.binnenkort")}
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account, McpInfo, PreviewInfo, Project } from "../lib/api";
import ChatPanel from "./chat/ChatPanel";
import PreviewPanel from "./PreviewPanel";
import AppearancePanel from "./kits/AppearancePanel";
import TerminalPanel, { type Session } from "./TerminalPanel";

export const TABS = ["maken", "uiterlijk", "publiceren", "geavanceerd"] as const;
export type Tab = (typeof TABS)[number];

interface Props {
  project: Project | null;
  accounts?: Account[];
  sessions?: Session[];
  mcp?: McpInfo | null;
  preview?: PreviewInfo | null;
  reloadNonce?: number;
  autoSwitch?: boolean;
  onAutoSwitch?: (v: boolean) => void;
  tab?: Tab;
  onTab?: (t: Tab) => void;
  /** "Technisch"-stand: ruwe details standaard zichtbaar. */
  technical?: boolean;
  onOpenAccounts?: () => void;
  onSessionsChange?: (updater: (prev: Session[]) => Session[]) => void;
  onError?: (msg: string) => void;
  onRetryMcp?: () => Promise<void> | void;
}

export default function Workspace({
  project,
  accounts = [],
  sessions = [],
  mcp = null,
  preview = null,
  reloadNonce = 0,
  autoSwitch = false,
  onAutoSwitch,
  tab: tabProp,
  onTab,
  technical = false,
  onOpenAccounts,
  onSessionsChange,
  onError,
  onRetryMcp,
}: Props) {
  const { t } = useTranslation();
  const [innerTab, setInnerTab] = useState<Tab>("maken");
  const tab = tabProp ?? innerTab;
  const setTab = onTab ?? setInnerTab;
  const fail = onError ?? (() => undefined);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label={t("app.naam")} className="flex gap-1 border-b border-border px-3 pt-2">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-11 rounded-t-lg px-6 text-lg ${tab === id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>
      {!project ? (
        <div role="tabpanel" className="flex flex-1 items-center justify-center text-lg text-muted-foreground">
          {t("tabs.geenProject")}
        </div>
      ) : (
        <>
          {/* Blijft gemount (verborgen) zodat gesprek, preview en lopende terminals hun toestand houden. */}
          <div role="tabpanel" hidden={tab !== "maken"} className={`min-h-0 flex-1 ${tab === "maken" ? "grid grid-cols-1 lg:grid-cols-2" : "hidden"}`}>
            <div className="min-h-0 min-w-0 border-r border-border">
              <ChatPanel
                key={project.id}
                project={project}
                accounts={accounts}
                technical={technical}
                onOpenAdvanced={() => setTab("geavanceerd")}
                onOpenAccounts={onOpenAccounts ?? (() => undefined)}
                onError={fail}
              />
            </div>
            <div className="hidden min-h-0 min-w-0 flex-col lg:flex">
              <PreviewPanel
                project={project}
                mcp={mcp}
                preview={preview}
                visible={tab === "maken"}
                reloadNonce={reloadNonce}
                autoSwitch={autoSwitch}
                onAutoSwitch={onAutoSwitch}
                onError={fail}
                onRetryMcp={onRetryMcp}
              />
            </div>
          </div>
          {tab === "uiterlijk" && (
            <div role="tabpanel" className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
              <div className="min-h-0 min-w-0 overflow-y-auto border-r border-border">
                <AppearancePanel key={project.id} projectId={project.id} firstRun={project.template !== "leeg"} onError={fail} />
              </div>
              <div className="hidden min-h-0 min-w-0 flex-col lg:flex">
                <PreviewPanel
                  project={project}
                  mcp={mcp}
                  preview={preview}
                  visible
                  reloadNonce={reloadNonce}
                  autoSwitch={autoSwitch}
                  onAutoSwitch={onAutoSwitch}
                  onError={fail}
                  onRetryMcp={onRetryMcp}
                />
              </div>
            </div>
          )}
          <div role="tabpanel" hidden={tab !== "geavanceerd"} className={`min-h-0 flex-1 flex-col ${tab === "geavanceerd" ? "flex" : "hidden"}`}>
            <TerminalPanel
              key={project.id}
              project={project}
              accounts={accounts}
              sessions={sessions}
              mcp={mcp}
              onSessionsChange={onSessionsChange ?? (() => undefined)}
              onError={fail}
              onRetryMcp={onRetryMcp}
            />
          </div>
          {tab === "publiceren" && (
            <div role="tabpanel" className="flex flex-1 items-center justify-center text-lg text-muted-foreground">
              {t("tabs.binnenkort")}
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account, McpInfo, PreviewInfo, Project } from "../lib/api";
import ChatPanel from "./app/chat/ChatPanel";
import PreviewPanel from "./PreviewPanel";
import AppearancePanel from "./kits/AppearancePanel";
import SplitView from "./app/SplitView";
import PublishPanel from "./app/PublishPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import TerminalPanel, { type Session } from "./TerminalPanel";

export const TABS = [
  "maken",
  "uiterlijk",
  "publiceren",
  "geavanceerd",
] as const;
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
  /** Opent het venster om een project te maken (vanuit het welkomstscherm). */
  onNewProject?: () => void;
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
  onNewProject,
  onSessionsChange,
  onError,
  onRetryMcp,
}: Props) {
  const { t } = useTranslation();
  const [innerTab, setInnerTab] = useState<Tab>("maken");
  const tab = tabProp ?? innerTab;
  const setTab = onTab ?? setInnerTab;
  const fail = onError ?? (() => undefined);

  const preview_ = (visible: boolean) => (
    <PreviewPanel
      project={project!}
      mcp={mcp}
      preview={preview}
      visible={visible}
      reloadNonce={reloadNonce}
      autoSwitch={autoSwitch}
      onAutoSwitch={onAutoSwitch}
      onError={fail}
      onRetryMcp={onRetryMcp}
    />
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="min-h-0 flex-1 gap-0"
    >
      {project && (
        <div className="border-b border-border px-3 pt-2">
          <TabsList
            aria-label={t("app.naam")}
            className="group-data-horizontal/tabs:h-14 gap-1"
          >
            {TABS.map((id) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-12 px-6 text-lg data-active:font-semibold"
              >
                {t(`tabs.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      )}
      {!project ? (
        <div
          role="tabpanel"
          className="flex flex-1 items-center justify-center p-8"
        >
          <div className="max-w-md space-y-4 text-center">
            <h2 className="text-2xl font-semibold">{t("welkom.titel")}</h2>
            <p className="text-lg text-muted-foreground">
              {t("welkom.uitleg")}
            </p>
            <p className="text-base text-muted-foreground">
              {t("tabs.geenProject")}
            </p>
            {onNewProject && (
              <Button size="lg" onClick={onNewProject}>
                <PlusIcon aria-hidden="true" />
                {t("welkom.knop")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Blijft gemount (verborgen) zodat gesprek, preview en lopende terminals hun toestand houden. */}
          <TabsContent
            value="maken"
            forceMount
            hidden={tab !== "maken"}
            className={tab === "maken" ? "flex min-h-0 flex-1" : "hidden"}
          >
            <SplitView
              id="maken"
              left={
                <ChatPanel
                  key={project.id}
                  project={project}
                  accounts={accounts}
                  technical={technical}
                  onOpenAdvanced={() => setTab("geavanceerd")}
                  onOpenAccounts={onOpenAccounts ?? (() => undefined)}
                  onError={fail}
                />
              }
              right={preview_(tab === "maken")}
            />
          </TabsContent>
          {tab === "uiterlijk" && (
            <TabsContent value="uiterlijk" className="flex min-h-0 flex-1">
              <SplitView
                id="uiterlijk"
                left={
                  <ScrollArea className="h-full">
                    <AppearancePanel
                      key={project.id}
                      projectId={project.id}
                      firstRun={project.template !== "leeg"}
                      onError={fail}
                    />
                  </ScrollArea>
                }
                right={preview_(true)}
              />
            </TabsContent>
          )}
          <TabsContent
            value="geavanceerd"
            forceMount
            hidden={tab !== "geavanceerd"}
            className={
              tab === "geavanceerd" ? "flex min-h-0 flex-1 flex-col" : "hidden"
            }
          >
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
          </TabsContent>
          <TabsContent value="publiceren" className="flex min-h-0 flex-1">
            <PublishPanel project={project} onError={fail} />
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  closeProject,
  listAccounts,
  listProjects,
  openProject,
  ptyClose,
  setDefaultAccount,
  type Account,
  type McpInfo,
  type PreviewInfo,
  getUiSetting,
  previewInfo,
  setUiSetting,
  type Project,
} from "./lib/api";
import AppSidebar from "@/components/app/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CircleAlertIcon } from "lucide-react";
import Workspace from "./components/Workspace";
import InfoPanel from "./components/InfoPanel";
import NewProjectDialog from "./components/NewProjectDialog";
import AccountsScreen from "./components/AccountsScreen";
import PreviewNotice from "./components/PreviewNotice";
import SettingsSheet from "@/components/app/SettingsSheet";
import type { CommunicationMode, PermissionMode } from "./components/SettingsScreen";
import type { Tab } from "./components/Workspace";
import type { Session } from "./components/TerminalPanel";

export default function App() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"project" | "accounts">("project");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<number, Session[]>>({});
  const [mcp, setMcp] = useState<Record<number, McpInfo | null>>({});
  const [preview, setPreview] = useState<Record<number, PreviewInfo | null>>({});
  const [reloadNonce, setReloadNonce] = useState<Record<number, number>>({});
  const [tab, setTab] = useState<Tab>("maken");
  const [communication, setCommunication] = useState<CommunicationMode>("simple");
  const [permission, setPermission] = useState<PermissionMode>("important");
  const [loopThreshold, setLoopThreshold] = useState(3);
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [notice, setNotice] = useState<number | null>(null);
  const [tick, setTick] = useState<Record<number, number>>({});

  const fail = useCallback((e: unknown) => setError(t("fout.algemeen", { bericht: String(e) })), [t]);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
      setProjects(await listProjects()); // standaardaccount kan zijn gewist
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listProjects(), listAccounts()])
      .then(([p, a]) => {
        if (cancelled) return;
        setProjects(p);
        setAccounts(a);
      })
      .catch((e) => !cancelled && fail(e));
    return () => {
      cancelled = true;
    };
  }, [fail]);

  useEffect(() => {
    const un = listen<{ project_id: number; info: McpInfo }>("mcp-status", (e) =>
      setMcp((m) => ({ ...m, [e.payload.project_id]: e.payload.info })),
    );
    return () => void un.then((f) => f());
  }, []);

  useEffect(() => {
    getUiSetting("preview_auto_switch")
      .then((v) => setAutoSwitch(v === "1"))
      .catch(() => undefined);
    getUiSetting("communication_mode")
      .then((v) => setCommunication(v === "technical" ? "technical" : "simple"))
      .catch(() => undefined);
    getUiSetting("loop_threshold")
      .then((v) => setLoopThreshold(v && Number(v) >= 2 && Number(v) <= 10 ? Number(v) : 3))
      .catch(() => undefined);
    getUiSetting("permission_mode")
      .then((v) => setPermission(v === "always" ? "always" : "important"))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Checks en git-gebeurtenissen verversen de zijbalk.
    const un = listen<{ project_id: number; payload: { event: string } }>("runtime-event", (e) => {
      const { project_id: id, payload } = e.payload;
      if (payload.event !== "dev") setTick((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
    });
    const st = listen<{ project_id: number; info: PreviewInfo }>("preview-state", (e) =>
      setPreview((m) => ({ ...m, [e.payload.project_id]: e.payload.info })),
    );
    const rl = listen<{ project_id: number }>("preview-reload", (e) =>
      setReloadNonce((m) => ({ ...m, [e.payload.project_id]: (m[e.payload.project_id] ?? 0) + 1 })),
    );
    const av = listen<{ project_id: number }>("preview-available", (e) => availableRef.current(e.payload.project_id));
    return () => {
      for (const u of [un, st, rl, av]) void u.then((f) => f());
    };
  }, []);

  // Een project "openen" = selecteren + zijn MCP-server starten.
  async function select(id: number) {
    setSelectedId(id);
    setView("project");
    try {
      const info = await openProject(id);
      setMcp((m) => ({ ...m, [id]: info }));
      previewInfo(id)
        .then((p) => setPreview((m) => ({ ...m, [id]: p })))
        .catch(() => undefined);
    } catch (e) {
      // De echte reden tonen in plaats van alleen "niet beschikbaar".
      setMcp((m) => ({ ...m, [id]: { state: "unavailable", port: null, error: String(e), kind: "error", log: [] } }));
    }
  }

  // Sluiten: terminals dicht en MCP-server stoppen. Het project blijft in de lijst.
  async function close(id: number) {
    await Promise.all((sessions[id] ?? []).map((s) => ptyClose(s.id).catch(() => undefined)));
    await closeProject(id).catch(() => undefined);
    setSessions((s) => ({ ...s, [id]: [] }));
    setMcp((m) => ({ ...m, [id]: null }));
    setPreview((m) => ({ ...m, [id]: null }));
    if (selectedId === id) {
      setSelectedId(null);
      setTab("maken");
    }
    toast.success(t("info.gesloten"));
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // "Preview beschikbaar": automatisch wisselen (instelbaar) of een melding met knop.
  const availableRef = useRef<(id: number) => void>(() => undefined);
  useEffect(() => {
    availableRef.current = (id: number) => {
      if (autoSwitch) {
        void select(id).then(() => setTab("maken"));
      } else {
        setNotice(id);
      }
    };
  });
  const noticeProject = notice != null ? projects.find((p) => p.id === notice) : null;

  return (
    <TooltipProvider>
    <SidebarProvider className="h-full min-h-0">
      <AppSidebar
        projects={projects}
        selectedId={view === "project" ? selectedId : null}
        accountsActive={view === "accounts"}
        onSelect={(id) => void select(id)}
        onNew={() => setDialogOpen(true)}
        onAccounts={() => setView("accounts")}
        settingsActive={settingsOpen}
        onSettings={() => setSettingsOpen(true)}
        onDeleted={async (id) => {
          await close(id);
          await refresh();
        }}
        onError={setError}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <Alert variant="destructive" className="rounded-none border-0 border-b border-destructive/50 bg-destructive/10">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription className="flex items-center justify-between gap-3 text-base text-foreground">
              <span role="alert" className="min-w-0 break-words">{error}</span>
              <Button size="sm" variant="outline" onClick={() => setError(null)}>
                {t("fout.sluit")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {noticeProject && (
          <PreviewNotice
            projectName={noticeProject.naam}
            onClose={() => setNotice(null)}
            onView={() => {
              const id = noticeProject.id;
              setNotice(null);
              void select(id).then(() => setTab("maken"));
            }}
          />
        )}
        {view === "accounts" ? (
          <AccountsScreen accounts={accounts} onChanged={refreshAccounts} onError={setError} />
        ) : (
          <Workspace
            project={selected}
            accounts={accounts}
            sessions={selected ? (sessions[selected.id] ?? []) : []}
            mcp={selected ? (mcp[selected.id] ?? null) : null}
            preview={selected ? (preview[selected.id] ?? null) : null}
            reloadNonce={selected ? (reloadNonce[selected.id] ?? 0) : 0}
            autoSwitch={autoSwitch}
            onAutoSwitch={(v) => {
              setAutoSwitch(v);
              void setUiSetting("preview_auto_switch", v ? "1" : "0").catch(() => undefined);
            }}
            tab={tab}
            onTab={setTab}
            technical={communication === "technical"}
            onOpenAccounts={() => setView("accounts")}
            onNewProject={() => setDialogOpen(true)}
            onSessionsChange={(fn) => selected && setSessions((s) => ({ ...s, [selected.id]: fn(s[selected.id] ?? []) }))}
            onError={setError}
            onRetryMcp={() => (selected ? select(selected.id) : undefined)}
          />
        )}
      </main>
      <InfoPanel
        project={selected}
        accounts={accounts}
        onDefaultAccount={async (accountId) => {
          if (!selected) return;
          try {
            await setDefaultAccount(selected.id, accountId);
            await refresh();
          } catch (e) {
            fail(e);
          }
        }}
        onClose={() => selected && void close(selected.id)}
        mcp={selected ? (mcp[selected.id] ?? null) : null}
        tick={selected ? (tick[selected.id] ?? 0) : 0}
        onError={setError}
        quietUnlessWide={view === "project" && tab === "maken"}
      />
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        communication={communication}
        permission={permission}
        loopThreshold={loopThreshold}
        onLoopThreshold={(n) => {
          setLoopThreshold(n);
          void setUiSetting("loop_threshold", String(n)).catch(fail);
        }}
        onCommunication={(v) => {
          setCommunication(v);
          void setUiSetting("communication_mode", v).catch(fail);
        }}
        onPermission={(v) => {
          setPermission(v);
          void setUiSetting("permission_mode", v).catch(fail);
        }}
      />
      {dialogOpen && (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={async (p) => {
            setDialogOpen(false);
            await refresh();
            await select(p.id);
            // Een startklaar web-project: eerst een uiterlijk laten kiezen.
            if (p.template !== "leeg") setTab("uiterlijk");
          }}
        />
      )}
      <Toaster position="bottom-right" richColors />
    </SidebarProvider>
    </TooltipProvider>
  );
}

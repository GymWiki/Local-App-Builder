import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  closeProject,
  deleteProject,
  listAccounts,
  listProjects,
  openProject,
  ptyClose,
  setDefaultAccount,
  type Account,
  type McpInfo,
  type PreviewInfo,
  previewInfo,
  projectThumbnailSet,
  runtime,
  type Project,
} from "./lib/api";
import HomeScreen from "@/components/app/home/HomeScreen";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import BevestigDialoog from "@/components/app/supabase/BevestigDialoog";
import ActieBevestig from "@/components/app/ActieBevestig";
import UpdateCheck from "@/components/app/update/UpdateCheck";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
} from "lucide-react";
import ProjectWorkspace from "@/components/app/workspace/ProjectWorkspace";
import type { PanelId } from "@/lib/layout";
import NewProjectDialog from "./components/NewProjectDialog";
import AccountsScreen from "./components/AccountsScreen";
import PreviewNotice from "./components/PreviewNotice";
import SettingsSheet from "@/components/app/SettingsSheet";
import { useSettings } from "@/components/app/settings-provider";
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
  const [preview, setPreview] = useState<Record<number, PreviewInfo | null>>(
    {},
  );
  const [reloadNonce, setReloadNonce] = useState<Record<number, number>>({});
  const [request, setRequest] = useState<{ id: PanelId; nonce: number } | null>(null);
  const ask = (id: PanelId) => setRequest((r) => ({ id, nonce: (r?.nonce ?? 0) + 1 }));
  const { settings, set: setSetting } = useSettings();
  const autoSwitch = settings.preview_auto_switch;
  const communication = settings.communication_mode;
  const [notice, setNotice] = useState<number | null>(null);
  const [tick, setTick] = useState<Record<number, number>>({});
  const [thumbNonce, setThumbNonce] = useState(0);

  const fail = useCallback(
    (e: unknown) => setError(t("fout.algemeen", { bericht: String(e) })),
    [t],
  );

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
    const un = listen<{ project_id: number; info: McpInfo }>(
      "mcp-status",
      (e) => setMcp((m) => ({ ...m, [e.payload.project_id]: e.payload.info })),
    );
    return () => void un.then((f) => f());
  }, []);

  useEffect(() => {
    // Checks en git-gebeurtenissen verversen de zijbalk.
    const un = listen<{ project_id: number; payload: { event: string } }>(
      "runtime-event",
      (e) => {
        const { project_id: id, payload } = e.payload;
        if (payload.event !== "dev")
          setTick((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
      },
    );
    const st = listen<{ project_id: number; info: PreviewInfo }>(
      "preview-state",
      (e) =>
        setPreview((m) => ({ ...m, [e.payload.project_id]: e.payload.info })),
    );
    const rl = listen<{ project_id: number }>("preview-reload", (e) =>
      setReloadNonce((m) => ({
        ...m,
        [e.payload.project_id]: (m[e.payload.project_id] ?? 0) + 1,
      })),
    );
    const av = listen<{ project_id: number }>("preview-available", (e) =>
      availableRef.current(e.payload.project_id),
    );
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
      setMcp((m) => ({
        ...m,
        [id]: {
          state: "unavailable",
          port: null,
          error: String(e),
          kind: "error",
          log: [],
        },
      }));
    }
  }

  // Sluiten: terminals dicht en MCP-server stoppen. Het project blijft in de lijst.
  async function close(id: number, melding = true) {
    await Promise.all(
      (sessions[id] ?? []).map((s) => ptyClose(s.id).catch(() => undefined)),
    );
    await closeProject(id).catch(() => undefined);
    setSessions((s) => ({ ...s, [id]: [] }));
    setMcp((m) => ({ ...m, [id]: null }));
    setPreview((m) => ({ ...m, [id]: null }));
    if (selectedId === id) {
      setSelectedId(null);
    }
    if (melding) toast.success(t("info.gesloten"));
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Een kleine afbeelding van de preview voor de projectkaart. Gaat dit mis (geen browser, preview uit), dan blijft de oude staan.
  async function captureThumbnail(id: number) {
    if (preview[id]?.status !== "running") return;
    try {
      const r = await Promise.race([
        runtime<{ data_url: string }>(id, "preview.thumbnail"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("time-out")), 6000),
        ),
      ]);
      await projectThumbnailSet(id, r.data_url);
      setThumbNonce((n) => n + 1);
    } catch {
      /* een ontbrekende miniatuur is geen fout voor de gebruiker */
    }
  }

  // Terug naar het homescherm: het project blijft openstaan (preview en terminals lopen door).
  function goHome() {
    const id = selectedId;
    setView("project");
    setSelectedId(null);
    if (id != null) void captureThumbnail(id);
  }

  // "Preview beschikbaar": automatisch wisselen (instelbaar) of een melding met knop.
  const availableRef = useRef<(id: number) => void>(() => undefined);
  useEffect(() => {
    availableRef.current = (id: number) => {
      if (id === selectedId) {
        // Het project staat al open: het voorbeeld gewoon naar voren halen, zonder melding.
        ask("preview");
      } else if (autoSwitch) {
        void select(id).then(() => ask("preview"));
      } else {
        setNotice(id);
      }
    };
  });
  const noticeProject =
    notice != null ? projects.find((p) => p.id === notice) : null;

  const accountsPage = view === "accounts";

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        {error && (
          <Alert variant="destructive" className="rounded-none border-0 border-b border-destructive/50 bg-destructive/10">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription className="flex items-center justify-between gap-3 text-base text-foreground">
              <span role="alert" className="min-w-0 break-words">
                {error}
              </span>
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
              void select(id).then(() => ask("preview"));
            }}
          />
        )}
        {accountsPage ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <Button variant="ghost" onClick={() => setView("project")}>
                <ArrowLeftIcon aria-hidden="true" />
                {selected ? selected.naam : t("home.alleProjecten")}
              </Button>
            </div>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AccountsScreen accounts={accounts} onChanged={refreshAccounts} onError={setError} />
            </main>
          </>
        ) : !selected ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <HomeScreen
              projects={projects}
              previews={preview}
              thumbnailNonce={thumbNonce}
              onOpen={(id) => void select(id)}
              onNew={() => setDialogOpen(true)}
              onAccounts={() => setView("accounts")}
              onSettings={() => setSettingsOpen(true)}
              onRenamed={async () => {
                await refresh();
                toast.success(t("home.hernoem.klaar"));
              }}
              onImported={async (p) => {
                await refresh();
                await select(p.id);
              }}
              onRemove={async (p) => {
                await close(p.id, false);
                await deleteProject(p.id).catch(fail);
                await refresh();
              }}
            />
          </main>
        ) : (
          <ProjectWorkspace
            key={selected.id}
            project={selected}
            accounts={accounts}
            sessions={sessions[selected.id] ?? []}
            mcp={mcp[selected.id] ?? null}
            preview={preview[selected.id] ?? null}
            reloadNonce={reloadNonce[selected.id] ?? 0}
            autoSwitch={autoSwitch}
            onAutoSwitch={(v) => {
              void setSetting("preview_auto_switch", v);
            }}
            technical={communication === "technical"}
            tick={tick[selected.id] ?? 0}
            request={request}
            onSessionsChange={(fn) => setSessions((s) => ({ ...s, [selected.id]: fn(s[selected.id] ?? []) }))}
            onError={setError}
            onRetryMcp={() => select(selected.id)}
            onDefaultAccount={async (accountId) => {
              try {
                await setDefaultAccount(selected.id, accountId);
                await refresh();
              } catch (e) {
                fail(e);
              }
            }}
            onAccountsChanged={refreshAccounts}
            onHome={goHome}
            onCloseProject={() => void close(selected.id)}
            onRenamed={async () => {
              await refresh();
              toast.success(t("home.hernoem.klaar"));
            }}
            onRemove={async (p) => {
              await close(p.id, false);
              await deleteProject(p.id).catch(fail);
              await refresh();
              setSelectedId(null);
            }}
          />
        )}
        <SettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          accounts={accounts}
          onAccountsChanged={refreshAccounts}
          onError={setError}
        />
        {dialogOpen && (
          <NewProjectDialog
            onClose={() => setDialogOpen(false)}
            onCreated={async (p) => {
              setDialogOpen(false);
              await refresh();
              await select(p.id);
              // Een startklaar web-project: eerst een uiterlijk laten kiezen.
              if (p.template !== "leeg") ask("uiterlijk");
            }}
          />
        )}
        <BevestigDialoog />
        <ActieBevestig />
        <UpdateCheck />
        <Toaster position="top-center" richColors />
      </div>
    </TooltipProvider>
  );
}

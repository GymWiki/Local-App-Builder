import { useCallback, useEffect, useState } from "react";
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
  type Project,
} from "./lib/api";
import Sidebar from "./components/Sidebar";
import Workspace from "./components/Workspace";
import InfoPanel from "./components/InfoPanel";
import NewProjectDialog from "./components/NewProjectDialog";
import AccountsScreen from "./components/AccountsScreen";
import type { Session } from "./components/TerminalPanel";

export default function App() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"project" | "accounts">("project");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<number, Session[]>>({});
  const [mcp, setMcp] = useState<Record<number, McpInfo | null>>({});

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

  // Een project "openen" = selecteren + zijn MCP-server starten.
  async function select(id: number) {
    setSelectedId(id);
    setView("project");
    try {
      const info = await openProject(id);
      setMcp((m) => ({ ...m, [id]: info }));
    } catch (e) {
      fail(e);
    }
  }

  // Sluiten: terminals dicht en MCP-server stoppen. Het project blijft in de lijst.
  async function close(id: number) {
    await Promise.all((sessions[id] ?? []).map((s) => ptyClose(s.id).catch(() => undefined)));
    await closeProject(id).catch(() => undefined);
    setSessions((s) => ({ ...s, [id]: [] }));
    setMcp((m) => ({ ...m, [id]: null }));
    if (selectedId === id) setSelectedId(null);
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects}
        selectedId={view === "project" ? selectedId : null}
        accountsActive={view === "accounts"}
        onSelect={(id) => void select(id)}
        onNew={() => setDialogOpen(true)}
        onAccounts={() => setView("accounts")}
        onDeleted={async (id) => {
          await close(id);
          await refresh();
        }}
        onError={setError}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div role="alert" className="cursor-pointer bg-red-900/60 px-4 py-2 text-sm" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {view === "accounts" ? (
          <AccountsScreen accounts={accounts} onChanged={refreshAccounts} onError={setError} />
        ) : (
          <Workspace
            project={selected}
            accounts={accounts}
            sessions={selected ? (sessions[selected.id] ?? []) : []}
            mcp={selected ? (mcp[selected.id] ?? null) : null}
            onSessionsChange={(fn) => selected && setSessions((s) => ({ ...s, [selected.id]: fn(s[selected.id] ?? []) }))}
            onError={setError}
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
      />
      {dialogOpen && (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={async (p) => {
            setDialogOpen(false);
            await refresh();
            await select(p.id);
          }}
        />
      )}
    </div>
  );
}

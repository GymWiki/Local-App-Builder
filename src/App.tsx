import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listProjects, type Project } from "./lib/api";
import Sidebar from "./components/Sidebar";
import Workspace from "./components/Workspace";
import InfoPanel from "./components/InfoPanel";
import NewProjectDialog from "./components/NewProjectDialog";

export default function App() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(t("fout.algemeen", { bericht: String(e) }));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => !cancelled && setProjects(list))
      .catch((e) => !cancelled && setError(t("fout.algemeen", { bericht: String(e) })));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => setDialogOpen(true)}
        onDeleted={async (id) => {
          if (id === selectedId) setSelectedId(null);
          await refresh();
        }}
        onError={setError}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div role="alert" className="bg-red-900/60 px-4 py-2 text-sm" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        <Workspace project={selected} />
      </main>
      <InfoPanel project={selected} />
      {dialogOpen && (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={async (p) => {
            setDialogOpen(false);
            await refresh();
            setSelectedId(p.id);
          }}
        />
      )}
    </div>
  );
}

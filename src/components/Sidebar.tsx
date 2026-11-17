import { useTranslation } from "react-i18next";
import { deleteProject, type Project } from "../lib/api";

interface Props {
  projects: Project[];
  selectedId: number | null;
  accountsActive: boolean;
  onAccounts: () => void;
  settingsActive?: boolean;
  onSettings?: () => void;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDeleted: (id: number) => void | Promise<void>;
  onError: (msg: string) => void;
}

export default function Sidebar({ projects, selectedId, accountsActive, settingsActive = false, onSettings, onSelect, onNew, onAccounts, onDeleted, onError }: Props) {
  const { t } = useTranslation();

  async function remove(p: Project) {
    if (!window.confirm(t("sidebar.bevestigVerwijder", { naam: p.naam }))) return;
    try {
      await deleteProject(p.id);
      await onDeleted(p.id);
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      <div className="px-4 py-3 text-lg font-semibold">{t("app.naam")}</div>
      <div className="px-3 pb-3">
        <button
          onClick={onNew}
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          {t("sidebar.nieuwProject")}
        </button>
      </div>
      <h2 className="px-4 pb-1 text-xs uppercase tracking-wide text-zinc-500">{t("sidebar.projecten")}</h2>
      <ul className="flex-1 overflow-y-auto">
        {projects.length === 0 && <li className="px-4 py-2 text-sm text-zinc-500">{t("sidebar.leeg")}</li>}
        {projects.map((p) => (
          <li
            key={p.id}
            className={`group flex items-center justify-between px-4 py-2 text-sm ${
              p.id === selectedId ? "bg-zinc-800" : "hover:bg-zinc-800/60"
            }`}
          >
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(p.id)}>
              {p.naam}
            </button>
            <button
              aria-label={t("sidebar.verwijder")}
              title={t("sidebar.verwijder")}
              className="ml-2 hidden text-zinc-500 hover:text-red-400 group-hover:block"
              onClick={() => void remove(p)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={onAccounts}
          aria-current={accountsActive}
          className={`w-full rounded px-3 py-2 text-left text-sm ${accountsActive ? "bg-zinc-800" : "hover:bg-zinc-800/60"}`}
        >
          {t("accounts.titel")}
        </button>
        {onSettings && (
          <button
            onClick={onSettings}
            aria-current={settingsActive}
            className={`mt-1 w-full rounded px-3 py-2 text-left text-sm ${settingsActive ? "bg-zinc-800" : "hover:bg-zinc-800/60"}`}
          >
            {t("sidebar.instellingen")}
          </button>
        )}
      </div>
    </aside>
  );
}

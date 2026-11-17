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
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="px-4 py-3 text-lg font-semibold">{t("app.naam")}</div>
      <div className="px-3 pb-3">
        <button
          onClick={onNew}
          className="w-full rounded bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90"
        >
          {t("sidebar.nieuwProject")}
        </button>
      </div>
      <h2 className="px-4 pb-1 text-xs uppercase tracking-wide text-muted-foreground">{t("sidebar.projecten")}</h2>
      <ul className="flex-1 overflow-y-auto">
        {projects.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">{t("sidebar.leeg")}</li>}
        {projects.map((p) => (
          <li
            key={p.id}
            className={`group flex items-center justify-between px-4 py-2 text-sm ${
              p.id === selectedId ? "bg-muted" : "hover:bg-muted/60"
            }`}
          >
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(p.id)}>
              {p.naam}
            </button>
            <button
              aria-label={t("sidebar.verwijder")}
              title={t("sidebar.verwijder")}
              className="ml-2 hidden text-muted-foreground hover:text-destructive group-hover:block"
              onClick={() => void remove(p)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-3">
        <button
          onClick={onAccounts}
          aria-current={accountsActive}
          className={`w-full rounded px-3 py-2 text-left text-sm ${accountsActive ? "bg-muted" : "hover:bg-muted/60"}`}
        >
          {t("accounts.titel")}
        </button>
        {onSettings && (
          <button
            onClick={onSettings}
            aria-current={settingsActive}
            className={`mt-1 w-full rounded px-3 py-2 text-left text-sm ${settingsActive ? "bg-muted" : "hover:bg-muted/60"}`}
          >
            {t("sidebar.instellingen")}
          </button>
        )}
      </div>
    </aside>
  );
}

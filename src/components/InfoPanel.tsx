import { useTranslation } from "react-i18next";
import type { Account, McpInfo, Project } from "../lib/api";
import ActivityPanel from "./ActivityPanel";

interface Props {
  project: Project | null;
  accounts: Account[];
  onDefaultAccount: (accountId: number | null) => void | Promise<void>;
  onClose: () => void;
  mcp?: McpInfo | null;
  tick?: number;
  onError?: (msg: string) => void;
  /** Op de rustige Maken-weergave alleen tonen op brede schermen. */
  quietUnlessWide?: boolean;
}

export default function InfoPanel({ project, accounts, onDefaultAccount, onClose, mcp = null, tick = 0, onError, quietUnlessWide = false }: Props) {
  const { t } = useTranslation();
  const rows: [string, string][] = project
    ? [
        [t("info.naam"), project.naam],
        [t("info.pad"), project.pad],
        [t("info.template"), project.template],
        [t("info.aangemaakt"), project.created_at],
      ]
    : [];

  return (
    <aside className={`w-72 shrink-0 overflow-y-auto border-l border-border bg-card p-4 ${quietUnlessWide ? "hidden 2xl:block" : ""}`}>
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{t("info.titel")}</h2>
      {project ? (
        <div className="space-y-5">
          <dl className="space-y-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("info.standaardAccount")}</span>
            <select
              value={project.default_account_id ?? ""}
              onChange={(e) => void onDefaultAccount(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block w-full rounded border border-border bg-background px-2 py-2"
            >
              <option value="">{t("terminal.systeemstandaard")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {t(`provider.${a.provider}`)} · {a.label}
                </option>
              ))}
            </select>
          </label>
          <ActivityPanel project={project} mcp={mcp} tick={tick} onError={onError ?? (() => undefined)} />
          <button onClick={onClose} className="w-full rounded border border-border px-3 py-2 text-sm hover:bg-muted">
            {t("info.sluit")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("info.geenSelectie")}</p>
      )}
    </aside>
  );
}

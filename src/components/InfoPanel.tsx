import { useTranslation } from "react-i18next";
import type { Account, Project } from "../lib/api";

interface Props {
  project: Project | null;
  accounts: Account[];
  onDefaultAccount: (accountId: number | null) => void | Promise<void>;
  onClose: () => void;
}

export default function InfoPanel({ project, accounts, onDefaultAccount, onClose }: Props) {
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
    <aside className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-900 p-4">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-zinc-500">{t("info.titel")}</h2>
      {project ? (
        <div className="space-y-5">
          <dl className="space-y-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-zinc-500">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <label className="block text-sm">
            <span className="text-zinc-500">{t("info.standaardAccount")}</span>
            <select
              value={project.default_account_id ?? ""}
              onChange={(e) => void onDefaultAccount(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2"
            >
              <option value="">{t("terminal.systeemstandaard")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {t(`provider.${a.provider}`)} · {a.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onClose} className="w-full rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800">
            {t("info.sluit")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">{t("info.geenSelectie")}</p>
      )}
    </aside>
  );
}

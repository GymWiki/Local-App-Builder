import { useTranslation } from "react-i18next";
import type { Project } from "../lib/api";

export default function InfoPanel({ project }: { project: Project | null }) {
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
        <dl className="space-y-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-zinc-500">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-zinc-500">{t("info.geenSelectie")}</p>
      )}
    </aside>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "../lib/api";

const TABS = ["terminal", "preview", "publiceren"] as const;
type Tab = (typeof TABS)[number];

export default function Workspace({ project }: { project: Project | null }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("terminal");

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex gap-1 border-b border-zinc-800 px-3 pt-2">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-t px-4 py-2 text-sm ${
              tab === id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-1 items-center justify-center text-zinc-500">
        {project ? t("tabs.binnenkort") : t("tabs.geenProject")}
      </div>
    </section>
  );
}

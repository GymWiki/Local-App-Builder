import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../lib/api";

interface Props {
  message: ChatMessage;
  /** Nog bezig (de AI werkt nu)? Anders tonen we een "bezig"-kaart uit een oude sessie als klaar. */
  live: boolean;
  /** "Technisch"-stand: details staan standaard open. */
  technical: boolean;
}

export default function ActionCard({ message, live, technical }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  const [open, setOpen] = useState(technical);
  const state: "running" | "done" | "error" = p.state === "running" && !live ? "done" : p.state;
  const kind: string = p.kind;
  const params = p.params ?? {};

  let title: string;
  if (kind === "run_checks" && p.fixed) title = t("chat.actie.run_checks_fixed");
  else if (kind === "run_checks" && state === "error") title = t("chat.actie.run_checks_error");
  else if ((kind === "file_created" || kind === "file_edited") && params.page) title = t(`chat.actie.${kind}_page`, { file: params.file });
  else if (kind === "save_version" && !params.message) title = t("chat.actie.save_version_leeg");
  else title = String(t(`chat.actie.${kind}`, { ...params, defaultValue: t("chat.actie.other") }));

  const icon = state === "running" ? "⏳" : state === "error" ? "⚠" : p.fixed ? "✔" : "✔";
  const tone = state === "error" ? "border-amber-600 bg-amber-950/40" : p.fixed ? "border-emerald-700 bg-emerald-950/30" : "border-zinc-700 bg-zinc-900";
  const hasDetails = !!(p.detail || p.summary);

  return (
    <div data-testid="action-card" data-state={state} className={`rounded-lg border ${tone} px-4 py-2 text-base`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={state === "running" ? "animate-pulse" : ""}>
          {icon}
        </span>
        <span className="flex-1">
          {title}
          <span className="sr-only">{state === "running" ? ` — ${t("chat.actieBezig")}` : state === "error" ? ` — ${t("chat.actieMislukt")}` : ` — ${t("chat.actieKlaar")}`}</span>
        </span>
        {hasDetails && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded px-2 py-1 text-sm text-indigo-300 hover:bg-zinc-800"
          >
            {open ? t("chat.verberg") : t("chat.details")}
          </button>
        )}
      </div>
      {state === "error" && !p.fixed && <p className="mt-1 text-sm text-amber-200">{t("chat.actieMislukt")}</p>}
      {open && hasDetails && (
        <pre data-testid="action-details" className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 font-mono text-sm text-zinc-300">
          {[p.detail, p.summary].filter(Boolean).join("\n\n")}
        </pre>
      )}
    </div>
  );
}

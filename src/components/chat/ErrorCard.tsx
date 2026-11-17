import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../lib/api";

interface Props {
  message: ChatMessage;
  technical: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpenAccounts: () => void;
}

/** Een fout in mensentaal, met een knop om het opnieuw te proberen en de technische details uitklapbaar. */
export default function ErrorCard({ message, technical, canRetry, onRetry, onOpenAccounts }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(technical);
  const code: string = message.payload.code ?? "unknown";
  const tech: string = message.payload.technical ?? "";
  const known = t(`chat.fout.${code}.titel`, { defaultValue: "" });
  const base = known ? code : "unknown";

  return (
    <div role="alert" data-testid="error-card" className="space-y-2 rounded-lg border border-red-600 bg-red-950/40 px-4 py-3 text-base">
      <div className="font-semibold text-red-100">{t(`chat.fout.${base}.titel`)}</div>
      <p className="text-zinc-200">{t(`chat.fout.${base}.uitleg`)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {canRetry && message.payload.retry !== false && (
          <button onClick={onRetry} className="min-h-11 rounded-lg bg-indigo-600 px-4 font-medium hover:bg-indigo-500">
            {t("chat.fout.opnieuw")}
          </button>
        )}
        {code === "not_logged_in" && (
          <button onClick={onOpenAccounts} className="min-h-11 rounded-lg border border-zinc-600 px-4 hover:bg-zinc-800">
            {t("chat.fout.not_logged_in.knop")}
          </button>
        )}
        {tech && (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded px-2 py-1 text-sm text-indigo-300 hover:bg-zinc-800">
            {t("chat.fout.technisch")}
          </button>
        )}
      </div>
      {open && tech && (
        <pre data-testid="error-details" className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 font-mono text-sm text-zinc-300">
          {tech}
        </pre>
      )}
    </div>
  );
}

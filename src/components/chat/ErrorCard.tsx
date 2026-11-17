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
    <div role="alert" data-testid="error-card" className="space-y-2 rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-base">
      <div className="font-semibold text-destructive">{t(`chat.fout.${base}.titel`)}</div>
      <p className="text-foreground">{t(`chat.fout.${base}.uitleg`)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {canRetry && message.payload.retry !== false && (
          <button onClick={onRetry} className="min-h-11 rounded-lg bg-primary text-primary-foreground px-4 font-medium hover:bg-primary/90">
            {t("chat.fout.opnieuw")}
          </button>
        )}
        {code === "not_logged_in" && (
          <button onClick={onOpenAccounts} className="min-h-11 rounded-lg border border-input px-4 hover:bg-muted">
            {t("chat.fout.not_logged_in.knop")}
          </button>
        )}
        {tech && (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded px-2 py-1 text-sm text-primary hover:bg-muted">
            {t("chat.fout.technisch")}
          </button>
        )}
      </div>
      {open && tech && (
        <pre data-testid="error-details" className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-3 font-mono text-sm text-muted-foreground">
          {tech}
        </pre>
      )}
    </div>
  );
}

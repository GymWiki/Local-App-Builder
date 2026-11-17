import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../lib/api";
import FormattedText from "./formatText";

interface Props {
  message: ChatMessage;
  technical: boolean;
  onAnswer: (allow: boolean) => void;
}

/** Toestemmingsvraag in gewone taal met Ja en Nee. Gevaarlijke acties krijgen een duidelijke waarschuwing en "Nee" als standaardfocus. */
export default function PermissionDialog({ message, technical, onAnswer }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  const [open, setOpen] = useState(technical);
  const danger = p.danger === true;
  const kind: string = p.kind;
  const params = p.params ?? {};
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), [message.id]);

  const isPlan = p.plan_exit === true;
  const question = String(
    p.outside_project ? t("chat.toestemming.vraag.buiten") : t(`chat.toestemming.vraag.${kind}`, { defaultValue: t("chat.toestemming.vraag.generic") }),
  );
  const explain = String(t(`chat.toestemming.uitleg.${kind}`, { ...params, defaultValue: t("chat.toestemming.uitleg.generic") }));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="perm-title"
        aria-describedby="perm-explain"
        className={`w-full max-w-lg space-y-4 rounded-xl border-2 bg-card p-6 shadow-2xl ${danger ? "border-destructive" : "border-primary"}`}
      >
        <div className="text-sm uppercase tracking-wide text-muted-foreground">{t("chat.toestemming.titel")}</div>
        <h2 id="perm-title" className="text-xl font-semibold">
          {isPlan ? t("chat.toestemming.planTitel") : question}
        </h2>
        <p id="perm-explain" className="text-lg text-foreground">
          {isPlan ? t("chat.toestemming.planUitleg") : explain}
        </p>
        {isPlan && (
          <div data-testid="plan-text" className="max-h-64 overflow-y-auto rounded-lg bg-background p-4 text-base text-foreground">
            <FormattedText text={String(p.detail ?? "")} />
          </div>
        )}
        {p.outside_project && <p className="text-base text-warning">{t("chat.toestemming.buitenProject")}</p>}
        {danger && (
          <p role="note" className="rounded-lg bg-destructive/15 p-3 text-base text-destructive">
            ⚠ {t("chat.toestemming.gevaar")}
          </p>
        )}
        {p.detail && !isPlan && (
          <div>
            <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-sm text-primary hover:underline">
              {t("chat.toestemming.details")}
            </button>
            {open && (
              <pre data-testid="perm-details" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-3 font-mono text-sm text-muted-foreground">
                {p.detail}
              </pre>
            )}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            ref={danger ? first : undefined}
            onClick={() => onAnswer(false)}
            className="min-h-12 min-w-24 rounded-lg border border-input px-6 text-lg hover:bg-muted"
          >
            {isPlan ? t("chat.toestemming.planNee") : t("chat.toestemming.nee")}
          </button>
          <button
            ref={danger ? undefined : first}
            onClick={() => onAnswer(true)}
            className={`min-h-12 min-w-24 rounded-lg px-6 text-lg font-semibold ${danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
          >
            {isPlan ? t("chat.toestemming.planJa") : t("chat.toestemming.ja")}
          </button>
        </div>
      </div>
    </div>
  );
}

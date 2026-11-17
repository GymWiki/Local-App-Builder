import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../lib/api";

interface Props {
  message: ChatMessage;
  /** Alleen de laatste melding heeft knoppen. */
  active: boolean;
  onRestore: (hash: string, title: string) => Promise<void> | void;
  onDiscuss: () => void;
  onOtherAi: () => void;
}

/** Vriendelijke onderbreking als de AI in cirkels draait, met drie duidelijke keuzes. */
export default function LoopAlertCard({ message, active, onRestore, onDiscuss, onOtherAi }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  const working: { hash: string; title: string } | null = p.last_working ?? null;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const reason: string = ["same_error", "same_step", "worse"].includes(p.reason) ? p.reason : "same_error";

  async function restore() {
    if (!working) return;
    setBusy(true);
    try {
      await onRestore(working.hash, working.title);
      setDone(t("chat.lus.terugKlaar", { titel: working.title }));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div role="alert" data-testid="loop-alert" className="space-y-3 rounded-xl border-2 border-warning bg-warning/10 p-5 text-lg">
      <div className="text-xl font-semibold">⏸ {t("chat.lus.titel")}</div>
      <p>{t(`chat.lus.uitleg.${reason}`, { aantal: p.streak })}</p>
      {done ? (
        <p role="status" className="rounded-lg bg-success/15 p-3 text-base text-success">
          {done}
        </p>
      ) : (
        active && (
          <>
            <p className="text-base text-muted-foreground">{t("chat.lus.vraag")}</p>
            <div className="flex flex-wrap gap-3">
              <button
                disabled={!working}
                onClick={() => setConfirm(true)}
                className="min-h-12 rounded-lg bg-primary text-primary-foreground px-5 font-semibold hover:bg-primary/90 disabled:opacity-40"
              >
                {t("chat.lus.terug")}
              </button>
              <button onClick={onDiscuss} className="min-h-12 rounded-lg border border-input px-5 hover:bg-muted">
                {t("chat.lus.overleg")}
              </button>
              <button onClick={onOtherAi} className="min-h-12 rounded-lg border border-input px-5 hover:bg-muted">
                {t("chat.lus.andere")}
              </button>
            </div>
            {!working && <p className="text-sm text-muted-foreground">{t("chat.lus.terugGeen")}</p>}
          </>
        )
      )}
      {confirm && working && (
        <div role="alertdialog" aria-label={t("chat.lus.terug")} className="space-y-3 rounded-lg border border-primary bg-card p-4">
          <div className="font-semibold">{t("chat.lus.terugBevestig", { titel: working.title })}</div>
          <p className="text-base text-muted-foreground">{t("chat.lus.terugUitleg")}</p>
          <div className="flex gap-3">
            <button disabled={busy} onClick={() => void restore()} className="min-h-11 rounded-lg bg-primary text-primary-foreground px-4 font-semibold hover:bg-primary/90 disabled:opacity-50">
              {t("chat.lus.terugJa")}
            </button>
            <button onClick={() => setConfirm(false)} className="min-h-11 rounded-lg border border-input px-4 hover:bg-muted">
              {t("nieuw.annuleer")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

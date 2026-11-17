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
    <div role="alert" data-testid="loop-alert" className="space-y-3 rounded-xl border-2 border-amber-500 bg-amber-950/30 p-5 text-lg">
      <div className="text-xl font-semibold">⏸ {t("chat.lus.titel")}</div>
      <p>{t(`chat.lus.uitleg.${reason}`, { aantal: p.streak })}</p>
      {done ? (
        <p role="status" className="rounded-lg bg-emerald-950 p-3 text-base text-emerald-200">
          {done}
        </p>
      ) : (
        active && (
          <>
            <p className="text-base text-zinc-300">{t("chat.lus.vraag")}</p>
            <div className="flex flex-wrap gap-3">
              <button
                disabled={!working}
                onClick={() => setConfirm(true)}
                className="min-h-12 rounded-lg bg-indigo-600 px-5 font-semibold hover:bg-indigo-500 disabled:opacity-40"
              >
                {t("chat.lus.terug")}
              </button>
              <button onClick={onDiscuss} className="min-h-12 rounded-lg border border-zinc-500 px-5 hover:bg-zinc-800">
                {t("chat.lus.overleg")}
              </button>
              <button onClick={onOtherAi} className="min-h-12 rounded-lg border border-zinc-500 px-5 hover:bg-zinc-800">
                {t("chat.lus.andere")}
              </button>
            </div>
            {!working && <p className="text-sm text-zinc-400">{t("chat.lus.terugGeen")}</p>}
          </>
        )
      )}
      {confirm && working && (
        <div role="alertdialog" aria-label={t("chat.lus.terug")} className="space-y-3 rounded-lg border border-indigo-500 bg-zinc-900 p-4">
          <div className="font-semibold">{t("chat.lus.terugBevestig", { titel: working.title })}</div>
          <p className="text-base text-zinc-300">{t("chat.lus.terugUitleg")}</p>
          <div className="flex gap-3">
            <button disabled={busy} onClick={() => void restore()} className="min-h-11 rounded-lg bg-indigo-600 px-4 font-semibold hover:bg-indigo-500 disabled:opacity-50">
              {t("chat.lus.terugJa")}
            </button>
            <button onClick={() => setConfirm(false)} className="min-h-11 rounded-lg border border-zinc-500 px-4 hover:bg-zinc-800">
              {t("nieuw.annuleer")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

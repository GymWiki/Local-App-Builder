import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { runtime, type Checkpoint, type RestoreResult } from "../../lib/api";
import { friendlyTitle, timeAgo } from "../../lib/time";

interface Props {
  projectId: number;
  onClose: () => void;
  onError: (msg: string) => void;
}

/** Tijdlijn met versies. Terugzetten is veilig: Studio bewaart eerst de huidige staat als versie. */
export default function VersionsDialog({ projectId, onClose, onError }: Props) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Checkpoint[] | null>(null);
  const [target, setTarget] = useState<Checkpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    runtime<Checkpoint[]>(projectId, "git.list", { limit: 50 })
      .then((l) => !cancelled && setVersions(l))
      .catch(() => !cancelled && setVersions([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, tick]);

  const restore = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await runtime<RestoreResult>(projectId, "git.restore", { hash: target.hash });
      setDone(r.unchanged ? t("versies.alGelijk") : t("versies.teruggezet", { titel: friendlyTitle(target.message) }));
      setTick((n) => n + 1);
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }, [projectId, target, onError, t]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-label={t("versies.titel")} className="flex max-h-[85vh] w-full max-w-xl flex-col gap-4 rounded-xl bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t("versies.titel")}</h2>
          <button onClick={onClose} className="min-h-10 rounded-lg border border-zinc-600 px-4 hover:bg-zinc-800">
            {t("versies.sluit")}
          </button>
        </div>
        <p className="text-base text-zinc-300">{t("versies.uitleg")}</p>
        {done && (
          <p role="status" className="rounded-lg bg-emerald-950 p-3 text-base text-emerald-200">
            {done}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions === null ? (
            <p className="text-zinc-400">{t("versies.laden")}</p>
          ) : versions.length === 0 ? (
            <p data-testid="versions-empty" className="text-zinc-300">
              {t("versies.leeg")}
            </p>
          ) : (
            <ol data-testid="versions-list" className="space-y-2">
              {versions.map((v, i) => (
                <li key={v.hash} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-lg">{friendlyTitle(v.message)}</div>
                    <div className="text-sm text-zinc-400">
                      {timeAgo(v.date)}
                      {i === 0 && ` · ${t("versies.huidig")}`}
                    </div>
                  </div>
                  {i > 0 && (
                    <button onClick={() => setTarget(v)} className="min-h-10 shrink-0 rounded-lg border border-indigo-500 px-3 text-base text-indigo-200 hover:bg-indigo-950">
                      {t("versies.terug")}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {target && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div role="alertdialog" aria-modal="true" aria-label={t("versies.terug")} className="w-full max-w-md space-y-4 rounded-xl border-2 border-indigo-500 bg-zinc-900 p-6">
            <h3 className="text-xl font-semibold">{t("versies.bevestigTitel", { titel: friendlyTitle(target.message) })}</h3>
            <p className="text-base text-zinc-200">{t("versies.bevestigUitleg")}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setTarget(null)} className="min-h-11 rounded-lg border border-zinc-500 px-5 hover:bg-zinc-800">
                {t("nieuw.annuleer")}
              </button>
              <button disabled={busy} onClick={() => void restore()} className="min-h-11 rounded-lg bg-indigo-600 px-5 font-semibold hover:bg-indigo-500 disabled:opacity-50">
                {t("versies.ja")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { chatSend, kitApply, kitList, kitScripts, runtime, type KitApplyOutcome, type KitCard, type KitList } from "../../lib/api";

interface Props {
  projectId: number;
  /** Eerste keer (nieuw project): iets vriendelijkere kop. */
  firstRun?: boolean;
  /** De gebruiker heeft een uiterlijk toegepast (of een eigen stijl aangevraagd). */
  onApplied: () => void;
  onError: (msg: string) => void;
}

type Phase = { kind: "pick" } | { kind: "confirm"; card: KitCard; mode: "kit" | "basis" } | { kind: "busy"; card: KitCard } | { kind: "done"; card: KitCard; out: KitApplyOutcome; mode: "kit" | "basis" };

export default function KitPicker({ projectId, firstRun = false, onApplied, onError }: Props) {
  const { t } = useTranslation();
  const [list, setList] = useState<KitList | null>(null);
  const [hover, setHover] = useState<KitCard | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [basis, setBasis] = useState(false);
  const [scriptsAsked, setScriptsAsked] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const fail = useCallback((e: unknown) => onError(t("fout.algemeen", { bericht: String(e) })), [onError, t]);

  useEffect(() => {
    let off = false;
    kitList(projectId)
      .then((l) => !off && setList(l))
      .catch((e) => !off && fail(e));
    return () => {
      off = true;
    };
  }, [projectId, fail]);

  async function apply(card: KitCard, mode: "kit" | "basis") {
    setPhase({ kind: "busy", card });
    try {
      const out = await kitApply(projectId, card.id);
      setPhase({ kind: "done", card, out, mode });
      if (out.ok && out.scriptsSkipped.length > 0) setScriptsAsked(out.scriptsSkipped);
      if (out.ok) {
        if (mode === "basis") {
          await chatSend(projectId, t("uiterlijk.eigen.kitPrompt", { naam: card.naam }));
          setNote(t("uiterlijk.eigen.verstuurd"));
        }
        onApplied();
      }
    } catch (e) {
      setPhase({ kind: "pick" });
      fail(e);
    }
  }

  async function runScripts(packages: string[]) {
    setScriptsAsked(null);
    try {
      const r = await kitScripts(projectId, packages);
      setNote(r.ok ? t("uiterlijk.scripts.klaar") : t("uiterlijk.scripts.mislukt", { detail: r.detail ?? "" }));
    } catch (e) {
      fail(e);
    }
  }

  async function ownStyle() {
    try {
      await chatSend(projectId, t("uiterlijk.eigen.prompt"));
      setNote(t("uiterlijk.eigen.verstuurd"));
    } catch (e) {
      fail(e);
    }
  }

  async function undo(hash: string) {
    try {
      await runtime(projectId, "git.restore", { hash });
      setRestored(true);
      onApplied();
    } catch (e) {
      fail(e);
    }
  }

  if (!list) return <p role="status" className="p-5 text-lg text-zinc-300">{t("uiterlijk.laden")}</p>;

  const shown = hover ?? list.kits.find((k) => k.compatible) ?? null;

  if (phase.kind === "busy") {
    return (
      <div role="status" className="space-y-3 p-5 text-lg">
        <div className="animate-pulse" aria-hidden="true">●</div>
        <p>{t("uiterlijk.bezig")}</p>
        <p className="text-base text-zinc-400">{phase.card.naam}</p>
      </div>
    );
  }

  if (phase.kind === "done") return <Result phase={phase} onBack={() => setPhase({ kind: "pick" })} note={note} restored={restored} onUndo={(h) => void undo(h)} onMigrate={() => void chatSend(projectId, t("uiterlijk.wissel.migreerPrompt", { naam: phase.card.naam })).then(() => setNote(t("uiterlijk.eigen.verstuurd"))).catch(fail)} scriptsAsked={scriptsAsked} onScripts={(ok) => (ok && scriptsAsked ? void runScripts(scriptsAsked) : setScriptsAsked(null))} />;

  return (
    <section aria-label={t("uiterlijk.titel")} className="space-y-4 p-5">
      <header>
        <h2 className="text-xl font-semibold">{firstRun ? t("uiterlijk.welkom") : t("uiterlijk.kiesKit")}</h2>
        <p className="mt-1 text-lg text-zinc-300">{t("uiterlijk.intro")}</p>
      </header>

      {note && <p role="status" className="rounded-lg bg-emerald-950/40 p-3 text-base">{note}</p>}

      <ul aria-label={t("uiterlijk.kiezer")} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {list.kits.map((k) => (
          <li key={k.id}>
            <article
              data-testid={`kit-${k.id}`}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(k)}
              className={`flex h-full flex-col gap-2 rounded-xl border p-4 ${k.compatible ? "border-zinc-600" : "border-zinc-800 opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-semibold">{k.naam}</h3>
                <span className="rounded-full bg-indigo-900 px-3 py-1 text-sm">{k.label}</span>
              </div>
              <div aria-hidden="true" className="flex gap-1">
                {[k.kleuren.primair, k.kleuren.achtergrond, k.kleuren.tekst].map((c) => (
                  <span key={c} style={{ background: c }} className="h-4 w-8 rounded border border-zinc-600" />
                ))}
              </div>
              <p className="text-base text-zinc-300">{k.beschrijving}</p>
              <p className="text-sm text-zinc-400">{t("uiterlijk.licentie", { licentie: k.licentie })}</p>
              <p className="text-sm text-zinc-400">{t("uiterlijk.geschiktVoor", { stacks: k.stacks.map((s) => t(`uiterlijk.stack.${s}`, { defaultValue: s })).join(", ") })}</p>
              {!k.compatible && <p className="text-sm text-amber-300">{t("uiterlijk.past")}</p>}
              <button
                disabled={!k.compatible}
                onClick={() => setPhase({ kind: "confirm", card: k, mode: basis ? "basis" : "kit" })}
                aria-label={`${basis ? t("uiterlijk.eigen.kitKies") : t("uiterlijk.kies")}: ${k.naam}`}
                className="mt-auto min-h-11 rounded-lg bg-indigo-600 px-4 text-base font-medium hover:bg-indigo-500 disabled:opacity-40"
              >
                {basis ? t("uiterlijk.eigen.kitKies") : t("uiterlijk.kies")}
              </button>
            </article>
          </li>
        ))}
      </ul>

      <aside aria-live="polite" data-testid="kit-live" className="rounded-xl border border-zinc-700 p-3">
        {shown?.preview ? (
          <img src={shown.preview} alt={t("uiterlijk.livevoorbeeld", { naam: shown.naam })} className="w-full rounded-lg border border-zinc-700" />
        ) : (
          <p className="text-base text-zinc-400">{t("uiterlijk.geenPreview")}</p>
        )}
      </aside>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="space-y-2 rounded-xl border border-zinc-700 p-4">
          <h3 className="text-lg font-semibold">{t("uiterlijk.eigen.titel")}</h3>
          <p className="text-base text-zinc-300">{t("uiterlijk.eigen.uitleg")}</p>
          <button onClick={() => void ownStyle()} className="min-h-11 rounded-lg border border-zinc-500 px-4 text-base hover:bg-zinc-800">
            {t("uiterlijk.eigen.kies")}
          </button>
        </article>
        <article className="space-y-2 rounded-xl border border-zinc-700 p-4">
          <h3 className="text-lg font-semibold">{t("uiterlijk.eigen.kitTitel")}</h3>
          <p className="text-base text-zinc-300">{t("uiterlijk.eigen.kitUitleg")}</p>
          <button
            aria-pressed={basis}
            onClick={() => setBasis((b) => !b)}
            className={`min-h-11 rounded-lg border px-4 text-base ${basis ? "border-indigo-400 bg-indigo-900" : "border-zinc-500 hover:bg-zinc-800"}`}
          >
            {t("uiterlijk.eigen.kitKies")}
          </button>
        </article>
      </div>

      {phase.kind === "confirm" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-label={phase.card.naam} className="w-full max-w-lg space-y-3 rounded-xl bg-zinc-900 p-6 text-lg shadow-xl">
            <h3 className="text-xl font-semibold">{phase.card.naam}</h3>
            <p>{t("uiterlijk.licentie", { licentie: phase.card.licentie })}</p>
            {phase.card.pakketten.length > 0 && (
              <div>
                <p>{t("uiterlijk.pakketten")}</p>
                <ul className="list-disc pl-6 text-base">
                  {phase.card.pakketten.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {phase.card.installatiescripts && <p role="note" className="text-base text-amber-300">{t("uiterlijk.scriptsWaarschuwing")}</p>}
            {phase.card.attributieVerplicht && <p role="note" className="text-base text-amber-300">{t("uiterlijk.attributieNodig")}</p>}
            <p className="text-base text-zinc-300">{t("uiterlijk.veiligheid")}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPhase({ kind: "pick" })} className="min-h-11 rounded-lg px-4 hover:bg-zinc-800">
                {t("uiterlijk.annuleer")}
              </button>
              <button autoFocus onClick={() => void apply(phase.card, phase.mode)} className="min-h-11 rounded-lg bg-indigo-600 px-5 font-semibold hover:bg-indigo-500">
                {t("uiterlijk.toepassen")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Result({
  phase,
  onBack,
  note,
  restored,
  onUndo,
  onMigrate,
  scriptsAsked,
  onScripts,
}: {
  phase: { card: KitCard; out: KitApplyOutcome; mode: "kit" | "basis" };
  onBack: () => void;
  note: string | null;
  restored: boolean;
  onUndo: (hash: string) => void;
  onMigrate: () => void;
  scriptsAsked: string[] | null;
  onScripts: (ok: boolean) => void;
}) {
  const { t } = useTranslation();
  const { out, card } = phase;
  if (!out.ok) {
    return (
      <div role="alert" className="space-y-3 p-5 text-lg">
        <h2 className="text-xl font-semibold">{t(`uiterlijk.fout.${out.code}`)}</h2>
        {out.code !== "install_failed" && out.code !== "checks_failed" && out.detail && <p>{out.detail}</p>}
        {!out.rolledBack && (out.code === "install_failed" || out.code === "checks_failed") && <p>{t("uiterlijk.fout.terugzettenMislukt")}</p>}
        {out.detail && (out.code === "install_failed" || out.code === "checks_failed") && (
          <details className="text-base text-zinc-300">
            <summary className="cursor-pointer">{t("uiterlijk.details")}</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 text-sm">{out.detail}</pre>
          </details>
        )}
        <button onClick={onBack} className="min-h-11 rounded-lg border border-zinc-500 px-4 hover:bg-zinc-800">
          {t("uiterlijk.kiesKit")}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4 p-5 text-lg">
      <p role="status" className="text-xl font-semibold">{t("uiterlijk.klaar", { naam: card.naam })}</p>
      {out.checksSkipped && <p className="text-base text-amber-300">{t("uiterlijk.controleOvergeslagen", { reden: out.checksSkipped })}</p>}
      {note && <p role="status" className="rounded-lg bg-emerald-950/40 p-3 text-base">{note}</p>}
      {out.switched && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {([["voor", out.shotBefore], ["na", out.shotAfter]] as const).map(([k, src]) => (
              <figure key={k} className="space-y-1">
                <figcaption className="text-base font-semibold">{t(`uiterlijk.wissel.${k}`)}</figcaption>
                {src ? <img src={src} alt={t(`uiterlijk.wissel.${k}`)} className="w-full rounded-lg border border-zinc-700" /> : <p className="text-base text-zinc-400">{t("uiterlijk.wissel.geenBeeld")}</p>}
              </figure>
            ))}
          </div>
          <p className="text-base text-zinc-300">{t("uiterlijk.wissel.migreerUitleg")}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={onMigrate} className="min-h-11 rounded-lg bg-indigo-600 px-4 font-medium hover:bg-indigo-500">
              {t("uiterlijk.wissel.migreer")}
            </button>
            {out.before && !restored && (
              <button onClick={() => onUndo(out.before!)} className="min-h-11 rounded-lg border border-zinc-500 px-4 hover:bg-zinc-800">
                {t("uiterlijk.wissel.terug")}
              </button>
            )}
          </div>
          {restored && <p role="status" className="text-base">{t("uiterlijk.wissel.teruggezet")}</p>}
        </div>
      )}
      {scriptsAsked && (
        <div role="dialog" aria-label={t("uiterlijk.scripts.titel")} className="space-y-2 rounded-xl border border-amber-600 p-4">
          <h3 className="font-semibold">{t("uiterlijk.scripts.titel")}</h3>
          <p className="text-base">{t("uiterlijk.scripts.uitleg", { pakketten: scriptsAsked.join(", ") })}</p>
          <div className="flex gap-2">
            <button onClick={() => onScripts(true)} className="min-h-11 rounded-lg bg-indigo-600 px-4 hover:bg-indigo-500">{t("uiterlijk.scripts.ja")}</button>
            <button onClick={() => onScripts(false)} className="min-h-11 rounded-lg border border-zinc-500 px-4 hover:bg-zinc-800">{t("uiterlijk.scripts.nee")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

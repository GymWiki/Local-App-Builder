import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { kitCurrent, kitTailor, runtime, type KitCurrent, type KitTailor } from "../../lib/api";
import KitPicker from "./KitPicker";

interface Props {
  projectId: number;
  /** Net een nieuw project: eerst een uiterlijk laten kiezen. */
  firstRun?: boolean;
  onError: (msg: string) => void;
}

const FONTS = {
  systeem: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  verdana: "Verdana, Geneva, sans-serif",
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
  mono: "ui-monospace, 'Courier New', monospace",
} as const;
type FontKey = keyof typeof FONTS;

const AFRONDING = ["scherp", "gemiddeld", "rond"] as const;
const RUIMTE = ["compact", "normaal", "ruim"] as const;

function fontKey(value: string | undefined): FontKey | "" {
  return (Object.entries(FONTS).find(([, v]) => v === value)?.[0] as FontKey | undefined) ?? "";
}

export default function AppearancePanel({ projectId, firstRun = false, onError }: Props) {
  const { t } = useTranslation();
  const [cur, setCur] = useState<KitCurrent | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fail = useCallback((e: unknown) => onError(t("fout.algemeen", { bericht: String(e) })), [onError, t]);
  const load = useCallback(() => {
    kitCurrent(projectId).then(setCur).catch(fail);
  }, [projectId, fail]);
  useEffect(load, [load]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function tailor(change: KitTailor, delay = 0) {
    if (timer.current) clearTimeout(timer.current);
    const go = async () => {
      try {
        const tokens = await kitTailor(projectId, change);
        setCur((c) => (c ? { ...c, tokens } : c));
        setMsg(null);
      } catch (e) {
        onError(t("uiterlijk.aanpassen.mislukt", { reden: String(e) }));
      }
    };
    if (delay) timer.current = setTimeout(() => void go(), delay);
    else await go();
  }

  async function save() {
    try {
      await runtime(projectId, "git.checkpoint", { message: "Uiterlijk aangepast" });
      setMsg(t("uiterlijk.aanpassen.bewaard"));
    } catch (e) {
      fail(e);
    }
  }

  if (!cur) return <p role="status" className="p-5 text-lg text-zinc-300">{t("uiterlijk.laden")}</p>;
  if (!cur.kit || choosing) {
    return (
      <div>
        {choosing && cur.kit && (
          <button onClick={() => setChoosing(false)} className="m-5 mb-0 min-h-11 rounded-lg border border-zinc-500 px-4 text-base hover:bg-zinc-800">
            {t("uiterlijk.annuleer")}
          </button>
        )}
        <KitPicker
          projectId={projectId}
          firstRun={firstRun && !cur.kit}
          onApplied={() => {
            load();
          }}
          onError={onError}
        />
      </div>
    );
  }

  const tok = cur.tokens;
  const afronding = tok?.instellingen?.afronding ?? "";
  const ruimte = tok?.instellingen?.ruimte ?? "";
  return (
    <section aria-label={t("uiterlijk.titel")} className="space-y-5 p-5 text-lg">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">{t("uiterlijk.huidig.titel")}</h2>
        <p data-testid="kit-current">
          {cur.kit.naam}
          {cur.kit.versie ? ` · ${t("uiterlijk.huidig.versie", { versie: cur.kit.versie })}` : ""} · {t("uiterlijk.licentie", { licentie: cur.kit.licentie })}
        </p>
      </header>

      {cur.attributie.required && !cur.attributie.ok && (
        <p role="alert" className="rounded-lg border border-amber-600 bg-amber-950/30 p-3 text-base">
          {t("uiterlijk.attributie.mist")}
        </p>
      )}

      <div className="space-y-4 rounded-xl border border-zinc-700 p-4">
        <div>
          <h3 className="text-lg font-semibold">{t("uiterlijk.aanpassen.titel")}</h3>
          <p className="text-base text-zinc-300">{t("uiterlijk.aanpassen.uitleg")}</p>
        </div>

        <label className="flex items-center gap-3">
          <span className="w-32">{t("uiterlijk.aanpassen.kleur")}</span>
          <input
            type="color"
            aria-label={t("uiterlijk.aanpassen.kleur")}
            value={tok?.kleuren.licht.primair ?? "#3d5ae8"}
            onChange={(e) => {
              const v = e.target.value;
              setCur((c) => (c && c.tokens ? { ...c, tokens: { ...c.tokens, kleuren: { ...c.tokens.kleuren, licht: { ...c.tokens.kleuren.licht, primair: v } } } } : c));
              void tailor({ hoofdkleur: v }, 300);
            }}
            className="h-11 w-16 rounded border border-zinc-600 bg-zinc-900"
          />
        </label>

        {([
          ["afronding", AFRONDING, afronding],
          ["ruimte", RUIMTE, ruimte],
        ] as const).map(([key, options, selected]) => (
          <div key={key} role="radiogroup" aria-label={t(`uiterlijk.aanpassen.${key}`)} className="flex flex-wrap items-center gap-2">
            <span className="w-32">{t(`uiterlijk.aanpassen.${key}`)}</span>
            {options.map((o) => (
              <button
                key={o}
                role="radio"
                aria-checked={selected === o}
                onClick={() => void tailor({ [key]: o } as KitTailor)}
                className={`min-h-11 rounded-lg border px-4 text-base ${selected === o ? "border-indigo-400 bg-indigo-800 font-semibold" : "border-zinc-600 hover:bg-zinc-800"}`}
              >
                {t(`uiterlijk.aanpassen.${key === "afronding" ? "afrondingen" : "ruimtes"}.${o}`)}
              </button>
            ))}
          </div>
        ))}

        <label className="flex items-center gap-3">
          <span className="w-32">{t("uiterlijk.aanpassen.lettertype")}</span>
          <select
            value={fontKey(tok?.typografie.lettertype)}
            onChange={(e) => void tailor({ lettertype: FONTS[e.target.value as FontKey] })}
            className="min-h-11 rounded-lg border border-zinc-600 bg-zinc-900 px-3 text-base"
          >
            {fontKey(tok?.typografie.lettertype) === "" && <option value="">{tok?.typografie.lettertype}</option>}
            {(Object.keys(FONTS) as FontKey[]).map((k) => (
              <option key={k} value={k}>
                {t(`uiterlijk.aanpassen.lettertypes.${k}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => void save()} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-base font-medium hover:bg-indigo-500">
            {t("uiterlijk.aanpassen.bewaar")}
          </button>
          <button onClick={() => void tailor({ reset: true })} className="min-h-11 rounded-lg border border-zinc-500 px-4 text-base hover:bg-zinc-800">
            {t("uiterlijk.aanpassen.standaard")}
          </button>
        </div>
        {msg && <p role="status" className="text-base text-emerald-300">{msg}</p>}
      </div>

      <button onClick={() => setChoosing(true)} className="min-h-11 rounded-lg border border-zinc-500 px-4 text-base hover:bg-zinc-800">
        {t("uiterlijk.huidig.andere")}
      </button>
    </section>
  );
}

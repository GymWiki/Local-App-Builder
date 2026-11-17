import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { chatSend, kitCheck, kitCurrent, kitStrictness, kitTailor, runtime, type KitCheck, type KitCurrent, type KitFinding, type KitTailor } from "../../lib/api";
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
  const [check, setCheck] = useState<KitCheck | null>(null);
  const [checking, setChecking] = useState(false);
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

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(await kitCheck(projectId));
    } catch (e) {
      fail(e);
    } finally {
      setChecking(false);
    }
  }

  async function strictness(level: "waarschuwen" | "blokkeren") {
    try {
      await kitStrictness(projectId, level);
      setCheck((c) => (c ? { ...c, strengheid: level } : c));
    } catch (e) {
      fail(e);
    }
  }

  async function askAi(prompt: string) {
    try {
      await chatSend(projectId, prompt);
      setMsg(t("uiterlijk.controle.verstuurd"));
    } catch (e) {
      fail(e);
    }
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

      <div className="space-y-3 rounded-xl border border-zinc-700 p-4">
        <div>
          <h3 className="text-lg font-semibold">{t("uiterlijk.controle.titel")}</h3>
          <p className="text-base text-zinc-300">{t("uiterlijk.controle.uitleg")}</p>
        </div>
        <button onClick={() => void runCheck()} disabled={checking} className="min-h-11 rounded-lg border border-zinc-500 px-4 text-base hover:bg-zinc-800 disabled:opacity-50">
          {checking ? t("uiterlijk.controle.bezig") : t("uiterlijk.controle.knop")}
        </button>
        {check && <CheckResult check={check} onFix={(p) => void askAi(p)} onStrictness={(l) => void strictness(l)} />}
      </div>

      <button onClick={() => setChoosing(true)} className="min-h-11 rounded-lg border border-zinc-500 px-4 text-base hover:bg-zinc-800">
        {t("uiterlijk.huidig.andere")}
      </button>
    </section>
  );
}

const RULES = ["kleur", "pixels", "lettertype", "native", "bibliotheek"] as const;

function CheckResult({ check, onFix, onStrictness }: { check: KitCheck; onFix: (prompt: string) => void; onStrictness: (l: "waarschuwen" | "blokkeren") => void }) {
  const { t } = useTranslation();
  const files = new Set(check.findings.map((f) => f.file)).size;
  const spot = (f: KitFinding) => `${f.file} (${t("uiterlijk.controle.regel", { regel: f.line })}): ${f.message}`;
  return (
    <div className="space-y-4">
      <p role="status" className={check.findings.length ? "text-amber-300" : "text-emerald-300"}>
        {check.findings.length === 0 ? t("uiterlijk.controle.alles", { aantal: check.scanned }) : t("uiterlijk.controle.gevonden", { aantal: check.findings.length, bestanden: files })}
      </p>
      {RULES.map((rule) => {
        const list = check.findings.filter((f) => f.rule === rule);
        if (list.length === 0) return null;
        return (
          <section key={rule} aria-label={t(`uiterlijk.controle.regels.${rule}.titel`)} className="space-y-2 rounded-lg border border-zinc-700 p-3">
            <h4 className="font-semibold">
              {t(`uiterlijk.controle.regels.${rule}.titel`)} ({list.length})
            </h4>
            <p className="text-base text-zinc-300">{t(`uiterlijk.controle.regels.${rule}.uitleg`)}</p>
            <ul className="space-y-2 text-base">
              {list.slice(0, 20).map((f) => (
                <li key={`${f.file}:${f.line}:${f.col}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{spot(f)}</span>
                  <button
                    onClick={() => onFix(t("uiterlijk.controle.prompt", { bestand: f.file, regel: f.line, melding: f.message, tip: f.fix }))}
                    className="min-h-10 rounded-lg border border-zinc-500 px-3 text-sm hover:bg-zinc-800"
                  >
                    {t("uiterlijk.controle.herstel")}
                  </button>
                </li>
              ))}
            </ul>
            {list.length > 1 && (
              <button
                onClick={() => onFix(t("uiterlijk.controle.promptAlles", { titel: t(`uiterlijk.controle.regels.${rule}.titel`), plekken: list.slice(0, 20).map((f) => `- ${f.file}:${f.line} ${f.message} ${f.fix}`).join("\n") }))}
                className="min-h-11 rounded-lg bg-indigo-600 px-4 text-base font-medium hover:bg-indigo-500"
              >
                {t("uiterlijk.controle.herstelAlles")}
              </button>
            )}
          </section>
        );
      })}
      <div role="radiogroup" aria-label={t("uiterlijk.controle.strengheid.titel")} className="space-y-2">
        <p className="font-semibold">{t("uiterlijk.controle.strengheid.titel")}</p>
        {(["waarschuwen", "blokkeren"] as const).map((l) => (
          <button
            key={l}
            role="radio"
            aria-checked={check.strengheid === l}
            onClick={() => onStrictness(l)}
            className={`mr-2 min-h-11 rounded-lg border px-4 text-base ${check.strengheid === l ? "border-indigo-400 bg-indigo-800 font-semibold" : "border-zinc-600 hover:bg-zinc-800"}`}
            title={t(`uiterlijk.controle.strengheid.${l}Uitleg`)}
          >
            {t(`uiterlijk.controle.strengheid.${l}`)}
          </button>
        ))}
        <p className="text-sm text-zinc-400">{t(`uiterlijk.controle.strengheid.${check.strengheid}Uitleg`)}</p>
      </div>
    </div>
  );
}

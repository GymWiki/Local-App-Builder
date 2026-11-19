import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { chatSend, kitCheck, kitCurrent, kitStrictness, kitTailor, runtime, type KitCheck, type KitCurrent, type KitFinding, type KitTailor } from "@/lib/api";
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
      toast.success(t("uiterlijk.controle.verstuurd"));
    } catch (e) {
      fail(e);
    }
  }

  async function save() {
    try {
      await runtime(projectId, "git.checkpoint", { message: "Uiterlijk aangepast" });
      toast.success(t("uiterlijk.aanpassen.bewaard"));
    } catch (e) {
      fail(e);
    }
  }

  if (!cur)
    return (
      <div role="status" className="space-y-3 p-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <span className="sr-only">{t("uiterlijk.laden")}</span>
      </div>
    );
  if (!cur.kit || choosing) {
    return (
      <div>
        {choosing && cur.kit && (
          <Button variant="outline" className="m-5 mb-0" onClick={() => setChoosing(false)}>
            {t("uiterlijk.annuleer")}
          </Button>
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
  const font = fontKey(tok?.typografie.lettertype);
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
        <Alert className="border-warning/50 bg-warning/10">
          <AlertDescription className="text-base text-foreground">{t("uiterlijk.attributie.mist")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("uiterlijk.aanpassen.titel")}</CardTitle>
          <CardDescription className="text-base">{t("uiterlijk.aanpassen.uitleg")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field orientation="horizontal">
            <FieldLabel htmlFor="kleur" className="w-32 text-base">
              {t("uiterlijk.aanpassen.kleur")}
            </FieldLabel>
            <Input
              id="kleur"
              type="color"
              value={tok?.kleuren.licht.primair ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setCur((c) => (c && c.tokens ? { ...c, tokens: { ...c.tokens, kleuren: { ...c.tokens.kleuren, licht: { ...c.tokens.kleuren.licht, primair: v } } } } : c));
                void tailor({ hoofdkleur: v }, 300);
              }}
              className="h-11 w-20 cursor-pointer p-1"
            />
          </Field>

          {(
            [
              ["afronding", AFRONDING, afronding],
              ["ruimte", RUIMTE, ruimte],
            ] as const
          ).map(([key, options, selected]) => (
            <Field key={key} orientation="horizontal">
              <span id={`label-${key}`} className="w-32 text-base font-medium">
                {t(`uiterlijk.aanpassen.${key}`)}
              </span>
              <ToggleGroup type="single" variant="outline" role="radiogroup" aria-labelledby={`label-${key}`} value={selected} onValueChange={(v) => v && void tailor({ [key]: v } as KitTailor)} spacing={0}>
                {options.map((o) => (
                  <ToggleGroupItem key={o} value={o} className="px-4 text-base data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    {t(`uiterlijk.aanpassen.${key === "afronding" ? "afrondingen" : "ruimtes"}.${o}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          ))}

          <Field>
            <span id="label-lettertype" className="text-base font-medium">
              {t("uiterlijk.aanpassen.lettertype")}
            </span>
            <ToggleGroup type="single" variant="outline" role="radiogroup" aria-labelledby="label-lettertype" value={font} onValueChange={(v) => v && void tailor({ lettertype: FONTS[v as FontKey] })} className="flex-wrap" spacing={1}>
              {(Object.keys(FONTS) as FontKey[]).map((k) => (
                <ToggleGroupItem key={k} value={k} style={{ fontFamily: FONTS[k] }} className="px-4 text-base data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {t(`uiterlijk.aanpassen.lettertypes.${k}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()}>{t("uiterlijk.aanpassen.bewaar")}</Button>
            <Button variant="outline" onClick={() => void tailor({ reset: true })}>
              {t("uiterlijk.aanpassen.standaard")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("uiterlijk.controle.titel")}</CardTitle>
          <CardDescription className="text-base">{t("uiterlijk.controle.uitleg")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={() => void runCheck()} disabled={checking}>
            {checking ? t("uiterlijk.controle.bezig") : t("uiterlijk.controle.knop")}
          </Button>
          {check && <CheckResult check={check} onFix={(p) => void askAi(p)} onStrictness={(l) => void strictness(l)} />}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => setChoosing(true)}>
        {t("uiterlijk.huidig.andere")}
      </Button>
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
      <p role="status" className={check.findings.length ? "text-warning" : "text-success"}>
        {check.findings.length === 0 ? t("uiterlijk.controle.alles", { aantal: check.scanned }) : t("uiterlijk.controle.gevonden", { aantal: check.findings.length, bestanden: files })}
      </p>
      {RULES.map((rule) => {
        const list = check.findings.filter((f) => f.rule === rule);
        if (list.length === 0) return null;
        return (
          <Card key={rule} role="region" aria-label={t(`uiterlijk.controle.regels.${rule}.titel`)} size="sm">
            <CardHeader>
              <CardTitle>
                {t(`uiterlijk.controle.regels.${rule}.titel`)} ({list.length})
              </CardTitle>
              <CardDescription className="text-base">{t(`uiterlijk.controle.regels.${rule}.uitleg`)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2 text-base">
                {list.slice(0, 20).map((f) => (
                  <li key={`${f.file}:${f.line}:${f.col}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words">{spot(f)}</span>
                    <Button variant="outline" size="sm" onClick={() => onFix(t("uiterlijk.controle.prompt", { bestand: f.file, regel: f.line, melding: f.message, tip: f.fix }))}>
                      {t("uiterlijk.controle.herstel")}
                    </Button>
                  </li>
                ))}
              </ul>
              {list.length > 1 && (
                <Button
                  onClick={() =>
                    onFix(
                      t("uiterlijk.controle.promptAlles", {
                        titel: t(`uiterlijk.controle.regels.${rule}.titel`),
                        plekken: list.slice(0, 20).map((f) => `- ${f.file}:${f.line} ${f.message} ${f.fix}`).join("\n"),
                      }),
                    )
                  }
                >
                  {t("uiterlijk.controle.herstelAlles")}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
      <div className="space-y-2">
        <p id="strengheid-label" className="font-semibold">
          {t("uiterlijk.controle.strengheid.titel")}
        </p>
        <ToggleGroup type="single" variant="outline" role="radiogroup" aria-labelledby="strengheid-label" value={check.strengheid} onValueChange={(v) => v && onStrictness(v as "waarschuwen" | "blokkeren")} spacing={0}>
          {(["waarschuwen", "blokkeren"] as const).map((l) => (
            <ToggleGroupItem key={l} value={l} title={t(`uiterlijk.controle.strengheid.${l}Uitleg`)} className="px-4 text-base data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              {t(`uiterlijk.controle.strengheid.${l}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-sm text-muted-foreground">{t(`uiterlijk.controle.strengheid.${check.strengheid}Uitleg`)}</p>
      </div>
    </div>
  );
}

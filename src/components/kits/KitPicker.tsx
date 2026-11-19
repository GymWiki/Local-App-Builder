import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { chatSend, kitApply, kitList, kitScripts, runtime, type KitApplyOutcome, type KitCard, type KitList } from "@/lib/api";

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
          toast.success(t("uiterlijk.eigen.verstuurd"));
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
      (r.ok ? toast.success : toast.error)(r.ok ? t("uiterlijk.scripts.klaar") : t("uiterlijk.scripts.mislukt", { detail: r.detail ?? "" }));
    } catch (e) {
      fail(e);
    }
  }

  async function ownStyle() {
    try {
      await chatSend(projectId, t("uiterlijk.eigen.prompt"));
      toast.success(t("uiterlijk.eigen.verstuurd"));
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

  if (!list)
    return (
      <div role="status" className="space-y-3 p-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <span className="sr-only">{t("uiterlijk.laden")}</span>
      </div>
    );

  const shown = hover ?? list.kits.find((k) => k.compatible) ?? null;

  if (phase.kind === "busy") {
    return (
      <div role="status" className="space-y-3 p-5 text-lg">
        <Skeleton className="h-3 w-full max-w-md animate-pulse" />
        <p>{t("uiterlijk.bezig")}</p>
        <p className="text-base text-muted-foreground">{phase.card.naam}</p>
      </div>
    );
  }

  if (phase.kind === "done") {
    return (
      <Result
        phase={phase}
        onBack={() => setPhase({ kind: "pick" })}
        restored={restored}
        onUndo={(h) => void undo(h)}
        onMigrate={() =>
          void chatSend(projectId, t("uiterlijk.wissel.migreerPrompt", { naam: phase.card.naam }))
            .then(() => toast.success(t("uiterlijk.eigen.verstuurd")))
            .catch(fail)
        }
        scriptsAsked={scriptsAsked}
        onScripts={(ok) => (ok && scriptsAsked ? void runScripts(scriptsAsked) : setScriptsAsked(null))}
      />
    );
  }

  return (
    <section aria-label={t("uiterlijk.titel")} className="space-y-4 p-5">
      <header>
        <h2 className="text-xl font-semibold">{firstRun ? t("uiterlijk.welkom") : t("uiterlijk.kiesKit")}</h2>
        <p className="mt-1 text-lg text-muted-foreground">{t("uiterlijk.intro")}</p>
      </header>

      <ul aria-label={t("uiterlijk.kiezer")} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {list.kits.map((k) => (
          <li key={k.id}>
            <Card
              data-testid={`kit-${k.id}`}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(k)}
              className={`h-full ${k.compatible ? "" : "border-dashed"}`}
            >
              <CardHeader>
                <CardTitle className="text-lg">{k.naam}</CardTitle>
                <CardDescription className="text-base">{k.beschrijving}</CardDescription>
                <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
                  <Badge>{k.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div aria-hidden="true" className="flex gap-1">
                  {[k.kleuren.primair, k.kleuren.achtergrond, k.kleuren.tekst].map((c) => (
                    <span key={c} style={{ background: c }} className="h-4 w-8 rounded border border-border" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{t("uiterlijk.licentie", { licentie: k.licentie })}</p>
                <p className="text-sm text-muted-foreground">{t("uiterlijk.geschiktVoor", { stacks: k.stacks.map((s) => t(`uiterlijk.stack.${s}`, { defaultValue: s })).join(", ") })}</p>
                {!k.compatible && <p className="text-sm text-warning">{t("uiterlijk.past")}</p>}
              </CardContent>
              <CardFooter>
                <Button
                  disabled={!k.compatible}
                  onClick={() => setPhase({ kind: "confirm", card: k, mode: basis ? "basis" : "kit" })}
                  aria-label={`${basis ? t("uiterlijk.eigen.kitKies") : t("uiterlijk.kies")}: ${k.naam}`}
                  className="w-full"
                >
                  {basis ? t("uiterlijk.eigen.kitKies") : t("uiterlijk.kies")}
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>

      <aside aria-live="polite" data-testid="kit-live" className="rounded-xl border border-border p-3">
        {shown?.preview ? <img src={shown.preview} alt={t("uiterlijk.livevoorbeeld", { naam: shown.naam })} className="w-full rounded-lg border border-border" /> : <p className="text-base text-muted-foreground">{t("uiterlijk.geenPreview")}</p>}
      </aside>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("uiterlijk.eigen.titel")}</CardTitle>
            <CardDescription className="text-base">{t("uiterlijk.eigen.uitleg")}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => void ownStyle()}>
              {t("uiterlijk.eigen.kies")}
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("uiterlijk.eigen.kitTitel")}</CardTitle>
            <CardDescription className="text-base">{t("uiterlijk.eigen.kitUitleg")}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant={basis ? "default" : "outline"} aria-pressed={basis} onClick={() => setBasis((b) => !b)}>
              {t("uiterlijk.eigen.kitKies")}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={phase.kind === "confirm"} onOpenChange={(o) => !o && setPhase({ kind: "pick" })}>
        {phase.kind === "confirm" && (
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{phase.card.naam}</DialogTitle>
              <DialogDescription>{t("uiterlijk.licentie", { licentie: phase.card.licentie })}</DialogDescription>
            </DialogHeader>
            {phase.card.pakketten.length > 0 && (
              <div className="text-base">
                <p>{t("uiterlijk.pakketten")}</p>
                <ul className="list-disc pl-6">
                  {phase.card.pakketten.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {phase.card.installatiescripts && (
              <Alert role="note" className="border-warning/40 bg-warning/10">
                <AlertDescription className="text-warning">{t("uiterlijk.scriptsWaarschuwing")}</AlertDescription>
              </Alert>
            )}
            {phase.card.attributieVerplicht && (
              <Alert role="note" className="border-warning/40 bg-warning/10">
                <AlertDescription className="text-warning">{t("uiterlijk.attributieNodig")}</AlertDescription>
              </Alert>
            )}
            <p className="text-base text-muted-foreground">{t("uiterlijk.veiligheid")}</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPhase({ kind: "pick" })}>
                {t("uiterlijk.annuleer")}
              </Button>
              <Button autoFocus onClick={() => void apply(phase.card, phase.mode)}>
                {t("uiterlijk.toepassen")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

function Result({
  phase,
  onBack,
  restored,
  onUndo,
  onMigrate,
  scriptsAsked,
  onScripts,
}: {
  phase: { card: KitCard; out: KitApplyOutcome; mode: "kit" | "basis" };
  onBack: () => void;
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
      <div className="p-5">
        <Alert variant="destructive" className="space-y-3 text-lg">
          <AlertTitle className="text-xl font-semibold">{t(`uiterlijk.fout.${out.code}`)}</AlertTitle>
          <AlertDescription className="space-y-3 text-lg text-foreground">
            {out.code !== "install_failed" && out.code !== "checks_failed" && out.detail && <p>{out.detail}</p>}
            {!out.rolledBack && (out.code === "install_failed" || out.code === "checks_failed") && <p>{t("uiterlijk.fout.terugzettenMislukt")}</p>}
            {out.detail && (out.code === "install_failed" || out.code === "checks_failed") && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="px-0">
                    {t("uiterlijk.details")}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent forceMount>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{out.detail}</pre>
                </CollapsibleContent>
              </Collapsible>
            )}
            <Button variant="outline" onClick={onBack}>
              {t("uiterlijk.kiesKit")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className="space-y-4 p-5 text-lg">
      <p role="status" className="text-xl font-semibold">
        {t("uiterlijk.klaar", { naam: card.naam })}
      </p>
      {out.checksSkipped && <p className="text-base text-warning">{t("uiterlijk.controleOvergeslagen", { reden: out.checksSkipped })}</p>}
      {out.switched && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(
              [
                ["voor", out.shotBefore],
                ["na", out.shotAfter],
              ] as const
            ).map(([k, src]) => (
              <figure key={k} className="space-y-1">
                <figcaption className="text-base font-semibold">{t(`uiterlijk.wissel.${k}`)}</figcaption>
                {src ? <img src={src} alt={t(`uiterlijk.wissel.${k}`)} className="w-full rounded-lg border border-border" /> : <p className="text-base text-muted-foreground">{t("uiterlijk.wissel.geenBeeld")}</p>}
              </figure>
            ))}
          </div>
          <p className="text-base text-muted-foreground">{t("uiterlijk.wissel.migreerUitleg")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onMigrate}>{t("uiterlijk.wissel.migreer")}</Button>
            {out.before && !restored && (
              <Button variant="outline" onClick={() => onUndo(out.before!)}>
                {t("uiterlijk.wissel.terug")}
              </Button>
            )}
          </div>
          {restored && (
            <p role="status" className="text-base">
              {t("uiterlijk.wissel.teruggezet")}
            </p>
          )}
        </div>
      )}
      <AlertDialog open={!!scriptsAsked} onOpenChange={(o) => !o && onScripts(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("uiterlijk.scripts.titel")}</AlertDialogTitle>
            <AlertDialogDescription>{t("uiterlijk.scripts.uitleg", { pakketten: (scriptsAsked ?? []).join(", ") })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("uiterlijk.scripts.nee")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => onScripts(true)}>{t("uiterlijk.scripts.ja")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

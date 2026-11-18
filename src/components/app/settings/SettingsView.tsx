import BuildInfo from "./BuildInfo";
import UpdateRij from "@/components/app/update/UpdateRij";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon } from "lucide-react";
import { cliStatus, kiesMap, projectDescriptionGet, projectDescriptionSet, runtime, type Account, type CliStatus, type ConfigInfo, type McpInfo, type Project, type Provider } from "@/lib/api";
import { defaults } from "@/lib/settings";
import pakket from "../../../../package.json";
import AccountsScreen from "@/components/AccountsScreen";
import RenameProjectDialog from "@/components/app/home/RenameProjectDialog";
import RemoveProjectDialog from "@/components/app/home/RemoveProjectDialog";
import { useSettings } from "@/components/app/settings-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import KoppelingenOverzicht from "@/components/app/connect/KoppelingenOverzicht";
import NiveauKiezer from "@/components/app/supabase/NiveauKiezer";
import { useSupa } from "@/components/app/supabase/use-supa";
import Keuze from "./Keuze";
import Rij from "./Rij";

export type InstellingGroep = "project" | "ai" | "programma" | "gevorderd";

interface Props {
  /** "project": de instellingen van dit project (en die voor alle projecten). "app": alleen die voor alle projecten. */
  scope: "app" | "project";
  project?: Project | null;
  accounts: Account[];
  mcp?: McpInfo | null;
  groep?: InstellingGroep;
  onGroep?: (g: InstellingGroep) => void;
  onDefaultAccount?: (accountId: number | null) => void | Promise<void>;
  onAccountsChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
  onRenamed?: (p: Project) => void | Promise<void>;
  onRemove?: (p: Project) => void | Promise<void>;
  onOpenOnline?: () => void;
}

const SYSTEM = "__systeem__";
const PROVIDERS: Provider[] = ["claude", "gemini"];

/** Alle instellingen in vier groepen. Elke instelling staat op één plek en zegt of ze voor alle projecten of dit project geldt. */
export default function SettingsView({ scope, project, accounts, mcp, groep, onGroep, onDefaultAccount, onAccountsChanged, onError, onRenamed, onRemove, onOpenOnline }: Props) {
  const { t } = useTranslation();
  const { settings: s, set, reset } = useSettings();
  const d = defaults();
  const metProject = scope === "project" && !!project;
  const [lokaal, setLokaal] = useState<InstellingGroep>(metProject ? "project" : "ai");
  const actief = groep ?? lokaal;
  const kies = (g: string) => (onGroep ?? setLokaal)(g as InstellingGroep);

  return (
    <div className="max-w-3xl p-5" data-testid="instellingen">
      <p className="mb-4 text-base text-muted-foreground">{t("inst.uitleg")}</p>
      <Tabs value={actief} onValueChange={kies}>
        <TabsList className="h-auto w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto" aria-label={t("inst.titel")}>
          {metProject && <TabsTrigger value="project" className="h-10">{t("inst.groep.project")}</TabsTrigger>}
          <TabsTrigger value="ai" className="h-10">{t("inst.groep.ai")}</TabsTrigger>
          <TabsTrigger value="programma" className="h-10">{t("inst.groep.programma")}</TabsTrigger>
          <TabsTrigger value="gevorderd" className="h-10">{t("inst.groep.gevorderd")}</TabsTrigger>
        </TabsList>

        {metProject && project && (
          <TabsContent value="project" className="space-y-5 pt-4">
            <MijnProject project={project} onError={onError} onRenamed={onRenamed} onRemove={onRemove} />
          </TabsContent>
        )}

        <TabsContent value="ai" className="space-y-5 pt-4">
          {metProject && project && onDefaultAccount && (
            <Rij id="inst-account" label={t("inst.ai.account.label")} uitleg={t("inst.ai.account.uitleg")} bereik="dit">
              <Select value={project.default_account_id != null ? String(project.default_account_id) : SYSTEM} onValueChange={(v) => void onDefaultAccount(v === SYSTEM ? null : Number(v))}>
                <SelectTrigger className="w-full" aria-label={t("inst.ai.account.label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SYSTEM}>{t("inst.ai.account.standaard")}</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {t(`provider.${a.provider}`)} · {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Rij>
          )}
          {metProject && project && (
            <Rij id="inst-niveau" label={t("gegevens.niveau.titel")} uitleg={t("gegevens.niveau.uitleg")} bereik="dit">
              <NiveauInstelling projectId={project.id} />
            </Rij>
          )}
          <Rij id="inst-toestemming" label={t("inst.ai.toestemming.label")} uitleg={t("inst.ai.toestemming.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("permission_mode"), isStandaard: s.permission_mode === d.permission_mode }}>
            <Keuze
              naam="toestemming"
              label={t("inst.ai.toestemming.label")}
              waarde={s.permission_mode}
              onChange={(v) => void set("permission_mode", v)}
              opties={(["always", "important", "autonomous"] as const).map((v) => ({
                value: v,
                titel: t(`instellingen.toestemming.${v === "always" ? "altijd" : v === "important" ? "belangrijk" : "zelfstandig"}`),
                tekst: t(`instellingen.toestemming.${v === "always" ? "altijd" : v === "important" ? "belangrijk" : "zelfstandig"}Uitleg`),
              }))}
            />
            {s.permission_mode === "autonomous" && (
              <Alert className="mt-3" variant="destructive" data-testid="waarschuwing-zelfstandig">
                <AlertTriangleIcon aria-hidden="true" />
                <AlertDescription>{t("inst.ai.toestemming.waarschuwing")}</AlertDescription>
              </Alert>
            )}
            <p className="mt-2 text-sm text-muted-foreground">{t("inst.ai.toestemming.uitlegCli")}</p>
          </Rij>
          <Rij id="inst-taal-ai" label={t("inst.ai.taal.label")} uitleg={t("inst.ai.taal.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("communication_mode"), isStandaard: s.communication_mode === d.communication_mode }}>
            <Keuze
              naam="taal"
              label={t("inst.ai.taal.label")}
              waarde={s.communication_mode}
              onChange={(v) => void set("communication_mode", v)}
              opties={[
                { value: "simple", titel: t("instellingen.taal.eenvoudig"), tekst: t("instellingen.taal.eenvoudigUitleg") },
                { value: "technical", titel: t("instellingen.taal.technisch"), tekst: t("instellingen.taal.technischUitleg") },
              ]}
            />
          </Rij>
          <Rij id="inst-plan" label={t("inst.ai.plan.label")} uitleg={t("inst.ai.plan.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("plan_default"), isStandaard: s.plan_default === d.plan_default }}>
            <Switch checked={s.plan_default} onCheckedChange={(v) => void set("plan_default", v)} aria-label={t("inst.ai.plan.label")} />
          </Rij>
          <Rij id="inst-lus" label={t("inst.ai.lus.label")} uitleg={t("inst.ai.lus.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("loop_threshold"), isStandaard: s.loop_threshold === d.loop_threshold }}>
            <LusDrempel waarde={s.loop_threshold} onChange={(n) => void set("loop_threshold", n)} />
          </Rij>
          <Rij id="inst-accounts" label={t("inst.ai.accounts.titel")} uitleg={t("inst.ai.accounts.uitleg")} bereik="alle">
            <div className="-mx-5">
              <AccountsScreen accounts={accounts} onChanged={onAccountsChanged} onError={onError} />
            </div>
          </Rij>
        </TabsContent>

        <TabsContent value="programma" className="space-y-5 pt-4">
          <Rij id="inst-thema" label={t("inst.programma.thema.label")} uitleg={t("inst.programma.thema.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("theme"), isStandaard: s.theme === d.theme }}>
            <Keuze naam="thema" label={t("inst.programma.thema.label")} waarde={s.theme} onChange={(v) => void set("theme", v)} opties={(["system", "light", "dark"] as const).map((v) => ({ value: v, titel: t(`inst.programma.thema.${v}`) }))} />
          </Rij>
          <Rij id="inst-tekst" label={t("inst.programma.tekst.label")} uitleg={t("inst.programma.tekst.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("text_scale"), isStandaard: s.text_scale === d.text_scale }}>
            <Keuze naam="tekst" label={t("inst.programma.tekst.label")} waarde={String(s.text_scale) as "90"} onChange={(v) => void set("text_scale", Number(v) as 90)} opties={(["90", "100", "115", "130"] as const).map((v) => ({ value: v, titel: t(`inst.programma.tekst.${v}`) }))} />
          </Rij>
          <Rij id="inst-taalprogramma" label={t("inst.programma.taal.label")} uitleg={t("inst.programma.taal.uitleg")} bereik="alle">
            <Keuze naam="programmataal" label={t("inst.programma.taal.label")} waarde="nl" onChange={() => undefined} opties={[{ value: "nl", titel: t("inst.programma.taal.nl") }]} />
          </Rij>
          <Rij id="inst-map" label={t("inst.programma.map.label")} uitleg={t("inst.programma.map.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("default_project_dir"), isStandaard: s.default_project_dir === d.default_project_dir }}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="break-all text-base" data-testid="standaardmap">
                {s.default_project_dir || t("inst.programma.map.geen")}
              </span>
              <Button
                variant="outline"
                onClick={async () => {
                  const p = await kiesMap(s.default_project_dir || undefined).catch(() => null);
                  if (p) await set("default_project_dir", p);
                }}
              >
                {t("inst.programma.map.kies")}
              </Button>
            </div>
          </Rij>
          <Rij id="inst-voorbeeld" label={t("inst.programma.autoVoorbeeld.label")} uitleg={t("inst.programma.autoVoorbeeld.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("preview_auto_switch"), isStandaard: s.preview_auto_switch === d.preview_auto_switch }}>
            <Switch checked={s.preview_auto_switch} onCheckedChange={(v) => void set("preview_auto_switch", v)} aria-label={t("inst.programma.autoVoorbeeld.label")} />
          </Rij>
          <Rij id="inst-update" label={t("inst.programma.update.label")} uitleg={t("inst.programma.update.uitleg")} bereik="alle" herstel={{ onReset: () => void reset("update_check"), isStandaard: s.update_check === d.update_check }}>
            <div className="space-y-3">
              <Switch checked={s.update_check} onCheckedChange={(v) => void set("update_check", v)} aria-label={t("inst.programma.update.label")} />
              <UpdateRij />
            </div>
          </Rij>
          <Rij id="inst-eerste" label={t("inst.programma.eerste.label")} uitleg={t("inst.programma.eerste.uitleg")} bereik="alle">
            <Button variant="outline" data-testid="eerste-opnieuw" onClick={() => void set("eerste_start_klaar", false)}>
              {t("inst.programma.eerste.knop")}
            </Button>
          </Rij>
          <Rij id="inst-backup" label={t("inst.programma.backup.label")} uitleg={t("inst.programma.backup.uitleg")} bereik="dit">
            {onOpenOnline ? (
              <Button variant="outline" onClick={onOpenOnline}>
                {t("inst.programma.backup.knop")}
              </Button>
            ) : null}
          </Rij>
          <Rij id="inst-versie" label={t("inst.programma.versie.label")} uitleg={t("inst.programma.versie.uitleg")} bereik="alle">
            <p className="text-base">{t("inst.programma.versie.nu", { versie: pakket.version })}</p>
          </Rij>
          <Rij id="inst-licentie" label={t("inst.programma.licentie.label")} uitleg={t("inst.programma.licentie.uitleg")} bereik="alle">
            {null}
          </Rij>
          <Rij id="inst-privacy" label={t("inst.programma.privacy.label")} uitleg={t("inst.programma.privacy.uitleg")} bereik="alle">
            {null}
          </Rij>
          <Rij id="inst-sleutels" label={t("inst.programma.sleutels.label")} uitleg={t("inst.programma.sleutels.uitleg")} bereik="alle">
            <KoppelingenOverzicht />
          </Rij>
        </TabsContent>

        <TabsContent value="gevorderd" className="space-y-5 pt-4">
          <Gevorderd project={metProject ? project : null} mcp={mcp ?? null} />
        </TabsContent>
      </Tabs>
      <BuildInfo />
    </div>
  );
}

function LusDrempel({ waarde, onChange }: { waarde: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  const [tekst, setTekst] = useState(String(waarde));
  const [vorige, setVorige] = useState(waarde);
  if (vorige !== waarde) {
    // De waarde veranderde van buiten (bijvoorbeeld "Standaard herstellen"): toon die.
    setVorige(waarde);
    setTekst(String(waarde));
  }
  const n = Number(tekst);
  const geldig = /^\d+$/.test(tekst) && n >= 2 && n <= 10;
  return (
    <div className="space-y-1">
      <Input
        type="number"
        min={2}
        max={10}
        className="w-28"
        value={tekst}
        aria-label={t("inst.ai.lus.label")}
        aria-invalid={!geldig}
        onChange={(e) => {
          setTekst(e.target.value);
          const v = Number(e.target.value);
          if (/^\d+$/.test(e.target.value) && v >= 2 && v <= 10) onChange(v);
        }}
      />
      {!geldig && <p className="text-sm text-destructive">{t("inst.ai.lus.fout")}</p>}
    </div>
  );
}

function MijnProject({ project, onError, onRenamed, onRemove }: { project: Project; onError: (m: string) => void; onRenamed?: Props["onRenamed"]; onRemove?: Props["onRemove"] }) {
  const { t } = useTranslation();
  const [hernoem, setHernoem] = useState(false);
  const [verwijder, setVerwijder] = useState<Project | null>(null);
  const [tekst, setTekst] = useState("");
  const [bewaard, setBewaard] = useState(false);
  useEffect(() => {
    let off = false;
    void projectDescriptionGet(project.id)
      .then((x) => !off && setTekst(x ?? ""))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [project.id]);
  const opslaan = useCallback(async () => {
    try {
      await projectDescriptionSet(project.id, tekst);
      setBewaard(true);
    } catch (e) {
      onError(t("inst.project.beschrijving.fout", { reden: String(e) }));
    }
  }, [project.id, tekst, onError, t]);

  return (
    <>
      <Rij id="inst-naam" label={t("inst.project.naam.label")} uitleg={t("inst.project.naam.uitleg")} bereik="dit">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg" data-testid="projectnaam">
            {project.naam}
          </span>
          <Button variant="outline" onClick={() => setHernoem(true)}>
            {t("inst.project.naam.opslaan")}
          </Button>
        </div>
      </Rij>
      <Rij id="inst-icoon" label={t("inst.project.icoon.label")} uitleg={t("inst.project.icoon.uitleg")} bereik="dit">
        <p className="text-sm text-muted-foreground">{t("inst.project.icoon.binnenkort")}</p>
      </Rij>
      <Rij id="inst-beschrijving" label={t("inst.project.beschrijving.label")} uitleg={t("inst.project.beschrijving.uitleg")} bereik="dit">
        <Textarea
          value={tekst}
          maxLength={600}
          placeholder={t("inst.project.beschrijving.plaats")}
          aria-label={t("inst.project.beschrijving.label")}
          onChange={(e) => {
            setTekst(e.target.value);
            setBewaard(false);
          }}
        />
        <div className="mt-2 flex items-center gap-3">
          <Button variant="outline" onClick={() => void opslaan()}>
            {t("inst.project.beschrijving.opslaan")}
          </Button>
          {bewaard && <span role="status" className="text-sm text-muted-foreground">{t("inst.project.beschrijving.klaar")}</span>}
        </div>
      </Rij>
      <Rij id="inst-stack" label={t("inst.project.stack.label")} uitleg={t("inst.project.stack.uitleg")} bereik="dit">
        <p className="text-base">{project.template === "leeg" ? t("inst.project.stack.leeg") : t("inst.project.stack.web-react-vite")}</p>
        <p className="mt-1 break-all text-sm text-muted-foreground">
          {t("inst.project.map.label")}: {project.pad}
        </p>
      </Rij>
      <section data-instelling="inst-gevaar" className="space-y-2 rounded-xl border-2 border-destructive/40 p-4">
        <h3 className="text-lg font-semibold">{t("inst.project.gevaar.titel")}</h3>
        <p className="text-base text-muted-foreground">{t("inst.project.gevaar.uitleg")}</p>
        {onRemove && (
          <Button variant="destructive" onClick={() => setVerwijder(project)}>
            {t("inst.project.gevaar.knop")}
          </Button>
        )}
      </section>
      {hernoem && (
        <RenameProjectDialog
          project={project}
          onClose={() => setHernoem(false)}
          onRenamed={async (p) => {
            setHernoem(false);
            await onRenamed?.(p);
          }}
        />
      )}
      <RemoveProjectDialog
        project={verwijder}
        onCancel={() => setVerwijder(null)}
        onConfirm={async (p) => {
          setVerwijder(null);
          await onRemove?.(p);
        }}
      />
    </>
  );
}

function Gevorderd({ project, mcp }: { project: Project | null; mcp: McpInfo | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [clis, setClis] = useState<Record<string, CliStatus | null>>({});
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  useEffect(() => {
    if (!open) return;
    let off = false;
    for (const p of PROVIDERS)
      void cliStatus(p)
        .then((c) => !off && setClis((x) => ({ ...x, [p]: c })))
        .catch(() => undefined);
    if (project)
      void runtime<ConfigInfo>(project.id, "config.get")
        .then((c) => !off && setConfig(c))
        .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [open, project]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-4">
      <Alert>
        <AlertTriangleIcon aria-hidden="true" />
        <AlertDescription>{t("inst.gevorderd.waarschuwing")}</AlertDescription>
      </Alert>
      <CollapsibleTrigger asChild>
        <Button variant="outline">{open ? t("menu.gevorderd.dicht") : t("menu.gevorderd.open")}</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-5">
        <Rij id="inst-paden" label={t("inst.gevorderd.paden.label")} uitleg={t("inst.gevorderd.paden.uitleg")} bereik="alle">
          <ul className="space-y-1 text-base">
            {PROVIDERS.map((p) => (
              <li key={p}>
                <strong>{t(`provider.${p}`)}:</strong> <span className="break-all">{clis[p]?.path ?? t("inst.gevorderd.paden.niet")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">{t("inst.gevorderd.paden.node")}</p>
        </Rij>
        <Rij id="inst-poorten" label={t("inst.gevorderd.poorten.label")} uitleg={t("inst.gevorderd.poorten.uitleg")} bereik="dit">
          <p className="text-base">{mcp?.port ?? t("inst.gevorderd.poorten.geen")}</p>
        </Rij>
        <Rij id="inst-debug" label={t("inst.gevorderd.debug.label")} uitleg={t("inst.gevorderd.debug.uitleg")} bereik="alle">
          <p className="text-sm text-muted-foreground">{t("inst.gevorderd.debug.binnenkort")}</p>
        </Rij>
        <Rij id="inst-opdrachten" label={t("inst.gevorderd.opdrachten.label")} uitleg={t("inst.gevorderd.opdrachten.uitleg")} bereik="dit">
          {config?.exists && config.config ? (
            <div className="space-y-1 text-base">
              <ul className="font-mono text-sm">
                {Object.entries(config.config).map(([k, v]) => (
                  <li key={k}>
                    {k}: {String(v)}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">{config.trusted ? t("inst.gevorderd.opdrachten.goedgekeurd") : t("inst.gevorderd.opdrachten.nietGoedgekeurd")}</p>
            </div>
          ) : (
            <p className="text-base">{t("inst.gevorderd.opdrachten.geen")}</p>
          )}
        </Rij>
        <Rij id="inst-omgeving" label={t("inst.gevorderd.omgeving.label")} uitleg={t("inst.gevorderd.omgeving.uitleg")} bereik="dit">
          <p className="text-sm text-muted-foreground">{t("inst.gevorderd.omgeving.binnenkort")}</p>
        </Rij>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Hetzelfde bedieningsniveau als in "Wat je app onthoudt"; zonder koppeling een korte uitleg. */
function NiveauInstelling({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { state } = useSupa(projectId);
  if (!state.gekoppeld) return <p className="text-base text-muted-foreground">{t("gegevens.niveau.nietGekoppeld")}</p>;
  return <NiveauKiezer projectId={projectId} />;
}

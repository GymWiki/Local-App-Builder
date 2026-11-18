import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Layout, Model, type BorderNode, type ITabRenderValues, type ITabSetRenderValues, type TabNode, type TabSetNode } from "flexlayout-react";
import "flexlayout-react/style/light.css";
import { layoutGet, layoutReset, layoutSet, type Account, type McpInfo, type PreviewInfo, type Project } from "@/lib/api";
import { compacteIndeling, isPanelId, LayoutService, PANEL_IDS, type PanelId, type PresetId } from "@/lib/layout";
import { menuStatus, type MenuId } from "@/lib/menu";
import ChatPanel from "@/components/app/chat/ChatPanel";
import PreviewPanel from "@/components/PreviewPanel";
import TerminalPanel, { type Session } from "@/components/TerminalPanel";
import { useSettings } from "@/components/app/settings-provider";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import AppwinkelPanel from "./panels/AppwinkelPanel";
import BestandenPanel from "./panels/BestandenPanel";
import CodePanel from "./panels/CodePanel";
import EigenschappenPanel from "./panels/EigenschappenPanel";
import GegevensPanel from "./panels/GegevensPanel";
import HistoryPanel from "./panels/HistoryPanel";
import HulpPanel from "./panels/HulpPanel";
import LogsPanel from "./panels/LogsPanel";
import OnlinePanel from "./panels/OnlinePanel";
import SettingsView from "@/components/app/settings/SettingsView";
import SchermenPanel from "./panels/SchermenPanel";
import StartPanel from "./panels/StartPanel";
import StatusPanel from "./panels/StatusPanel";
import UiterlijkPanel from "./panels/UiterlijkPanel";
import type { PageInfo, PickedElement, PreviewControl } from "./pick";
import MovePanelMenu from "./MovePanelMenu";
import ShortcutsDialog from "./ShortcutsDialog";
import WorkspaceBar from "./WorkspaceBar";
import WorkspaceMenu from "./WorkspaceMenu";
import { ICONEN } from "./menuIcons";
import { WorkspaceProvider, type WorkspaceCtx } from "./workspace-context";
import { useProjectSignals } from "./useProjectSignals";
import { closePanel, geefRuimteAanEigenschappen, isOpen, isPreviewMaximized, openPanel, toggleMaximizePreview, zichtbaarIds } from "./modelActions";

/** Onder deze breedte (in CSS-pixels) toont de werkruimte een compacte indeling met tabbladen. */
export const COMPACT_BREEDTE = 1000;
/** Onder deze vensterbreedte klapt het menu vanzelf in tot iconen. */
export const MENU_SMAL = 1180;

const service = new LayoutService({
  get: layoutGet,
  set: layoutSet,
  reset: layoutReset,
});

interface Props {
  project: Project;
  accounts: Account[];
  sessions: Session[];
  mcp: McpInfo | null;
  preview: PreviewInfo | null;
  reloadNonce: number;
  autoSwitch: boolean;
  onAutoSwitch: (v: boolean) => void;
  technical: boolean;
  tick: number;
  /** Een verzoek van buiten om een paneel te tonen (bijvoorbeeld de preview zodra er iets te zien is). `nonce` maakt elk verzoek nieuw. */
  request: { id: PanelId; nonce: number } | null;
  onSessionsChange: (updater: (prev: Session[]) => Session[]) => void;
  onError: (msg: string) => void;
  onRetryMcp: () => Promise<void> | void;
  onDefaultAccount: (accountId: number | null) => void | Promise<void>;
  onAccountsChanged: () => void | Promise<void>;
  onHome: () => void;
  onCloseProject: () => void;
  onRenamed: (p: Project) => void | Promise<void>;
  onRemove: (p: Project) => void | Promise<void>;
}

/** De werkruimte van één project: links het menu, daarnaast een indeling van panelen die je kunt verschuiven en vergroten. */
export default function ProjectWorkspace(props: Props) {
  const { project, accounts, sessions, mcp, preview, onError } = props;
  const { t } = useTranslation();
  const { settings, set: setSetting } = useSettings();
  const [normal, setNormal] = useState<Model | null>(null);
  const [compact, setCompact] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const host = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<PickedElement | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const control = useRef<PreviewControl | null>(null);
  const [toonSneltoetsen, setToonSneltoetsen] = useState(false);
  const normalRef = useRef<Model | null>(null);
  // In een smal venster is het menu vanzelf ingeklapt tot iconen.
  const smalVenster = !useMediaQuery(`(min-width: ${MENU_SMAL + 1}px)`);
  const { signalen, ruw, vlaggen, ververs, setVlag } = useProjectSignals(project, mcp, preview, props.tick);

  // Indeling van dit project laden (valt altijd terug op de standaardindeling).
  useEffect(() => {
    let cancelled = false;
    void service.load(project.id).then((g) => {
      if (cancelled) return;
      const m = Model.fromJson(g.json);
      normalRef.current = m;
      setNormal(m);
    });
    return () => {
      cancelled = true;
      void service.flush();
    };
  }, [project.id]);

  // Smal venster: een tijdelijke compacte weergave; de opgeslagen indeling blijft zoals ze was.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const meet = () => setCompact(el.clientWidth > 0 && el.clientWidth < COMPACT_BREEDTE);
    meet();
    const ro = new ResizeObserver(meet);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compactModel = useMemo(() => (compact && normal ? Model.fromJson(compacteIndeling(normal.toJson())) : null), [compact, normal]);
  const model = compact && compactModel ? compactModel : normal;
  const isCompactView = model !== null && model === compactModel;

  const onModelChange = useCallback(
    (m: Model) => {
      if (m === normalRef.current) service.save(project.id, m.toJson());
      redraw();
    },
    [project.id],
  );

  const focusGesprek = useCallback(() => {
    if (!model) return;
    openPanel(model, "chat");
    setTimeout(() => document.getElementById("chat-input")?.focus(), 60);
  }, [model]);

  const openPaneel = useCallback(
    (id: PanelId) => {
      if (model) openPanel(model, id);
    },
    [model],
  );

  // Sneltoetsen: Ctrl (of Cmd) + Shift + S/P/G/E/L/M. Geen Alt, want dat is op veel toetsenborden de AltGr-toets.
  useEffect(() => {
    if (!model) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        e.preventDefault();
        focusGesprek();
      } else if (k === "s") {
        e.preventDefault();
        openPanel(model, "start");
      } else if (k === "p") {
        e.preventDefault();
        openPanel(model, "preview");
      } else if (k === "e") {
        e.preventDefault();
        if (isOpen(model, "eigenschappen")) closePanel(model, "eigenschappen");
        else openPanel(model, "eigenschappen");
      } else if (k === "l") {
        e.preventDefault();
        void setSetting("menu_collapsed", !settings.menu_collapsed);
      } else if (k === "m") {
        e.preventDefault();
        toggleMaximizePreview(model);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model, focusGesprek, setSetting, settings.menu_collapsed]);

  // Een paneel vanzelf naar voren halen als de rest van de app daarom vraagt.
  const verwerkt = useRef(props.request?.nonce ?? 0);
  useEffect(() => {
    const r = props.request;
    if (!model || !r || r.nonce === verwerkt.current) return;
    verwerkt.current = r.nonce;
    openPanel(model, r.id);
  }, [props.request, model]);

  const actief = model ? zichtbaarIds(model, PANEL_IDS) : new Set<PanelId>();

  async function applyPreset(preset: PresetId, melding = false) {
    const j = await service.reset(project.id, preset);
    const m = Model.fromJson(j);
    normalRef.current = m;
    setNormal(m);
    service.save(project.id, m.toJson());
    if (melding) toast.success(t("werkruimte.balk.herstelKlaar"));
  }

  const ctx: WorkspaceCtx = {
    project,
    accounts,
    mcp,
    preview,
    tick: props.tick,
    signalen,
    signals: ruw,
    vlaggen,
    verversSignalen: ververs,
    setVlag,
    openPaneel,
    focusGesprek,
    control,
    onError,
    onRetryMcp: props.onRetryMcp,
  };

  const factory = (node: TabNode): ReactNode => {
    const id = node.getComponent();
    if (!isPanelId(id)) return null;
    switch (id) {
      case "chat":
        return (
          <ChatPanel
            key={project.id}
            project={project}
            accounts={accounts}
            technical={props.technical}
            onOpenAdvanced={() => openPaneel("terminal")}
            onOpenAccounts={() => openPaneel("instellingen")}
            onError={onError}
          />
        );
      case "preview":
        return (
          <PreviewPanel
            project={project}
            mcp={mcp}
            preview={preview}
            visible={node.isVisible()}
            reloadNonce={props.reloadNonce}
            autoSwitch={props.autoSwitch}
            onAutoSwitch={props.onAutoSwitch}
            onError={onError}
            onRetryMcp={props.onRetryMcp}
            onSelect={(el) => {
              setSelection(el);
              if (model) {
                openPanel(model, "eigenschappen");
                geefRuimteAanEigenschappen(model);
              }
            }}
            onPage={setPage}
            controlRef={control}
          />
        );
      case "eigenschappen":
        return (
          <EigenschappenPanel
            projectId={project.id}
            selection={selection}
            page={page}
            control={control}
            previewRunning={preview?.status === "running"}
            onClear={() => {
              setSelection(null);
              control.current?.clear();
            }}
            onError={onError}
          />
        );
      case "terminal":
        return <TerminalPanel project={project} accounts={accounts} sessions={sessions} mcp={mcp} onSessionsChange={props.onSessionsChange} onError={onError} onRetryMcp={props.onRetryMcp} />;
      case "start":
        return <StartPanel />;
      case "schermen":
        return <SchermenPanel />;
      case "uiterlijk":
        return <UiterlijkPanel />;
      case "bestanden":
        return <BestandenPanel />;
      case "gegevens":
        return <GegevensPanel />;
      case "onlinezetten":
        return <OnlinePanel />;
      case "appwinkel":
        return <AppwinkelPanel />;
      case "versies":
        return <HistoryPanel project={project} mcp={mcp} tick={props.tick} onError={onError} />;
      case "instellingen":
        return (
          <ScrollArea className="h-full">
            <SettingsView
              scope="project"
              project={project}
              accounts={accounts}
              mcp={mcp}
              onDefaultAccount={props.onDefaultAccount}
              onAccountsChanged={props.onAccountsChanged}
              onError={onError}
              onRenamed={props.onRenamed}
              onRemove={props.onRemove}
              onOpenOnline={() => openPaneel("onlinezetten")}
            />
          </ScrollArea>
        );
      case "hulp":
        return <HulpPanel />;
      case "logs":
        return <LogsPanel />;
      case "technischestatus":
        return <StatusPanel />;
      case "code":
        return <CodePanel />;
    }
  };

  const onRenderTab = (node: TabNode, rv: ITabRenderValues) => {
    const id = node.getComponent();
    const Icon = isPanelId(id) ? ICONEN[id] : undefined;
    if (Icon) rv.leading = <Icon aria-hidden="true" className="size-4" />;
  };

  const onRenderTabSet = (node: TabSetNode | BorderNode, rv: ITabSetRenderValues) => {
    if (node.getType() !== "tabset" || !model) return;
    const sel = (node as TabSetNode).getSelectedNode();
    const id = sel?.getComponent();
    if (sel && isPanelId(id)) rv.buttons.unshift(<MovePanelMenu key="verplaats" model={model} id={id} />);
  };

  // Grotere stappen met het toetsenbord: Shift + pijltoets op een scheidingsgreep is acht keer zo groot als een gewone pijltoets.
  const onGripKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!e.shiftKey || el.getAttribute("role") !== "separator" || !e.key.startsWith("Arrow")) return;
    // Een voor een, met een korte pauze: de indeling moet na elke stap eerst bijwerken.
    for (let i = 1; i <= 7; i++) setTimeout(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: true, cancelable: true })), i * 40);
  };

  const i18nTranslator = (key: string): string => {
    if (key.startsWith("werkruimte.paneel.")) return t(key);
    const ui = `werkruimte.ui.${key}`;
    const vertaald = t(ui, { defaultValue: "" });
    return vertaald || key;
  };

  async function voegToe(id: MenuId) {
    if (id === "gegevens") await setVlag("gegevens_aan", "1");
    setTimeout(() => openPaneel(id), 150);
  }

  return (
    <WorkspaceProvider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="workspace">
        <WorkspaceBar
          mcp={mcp}
          preview={preview}
          maximized={model ? isPreviewMaximized(model) : false}
          onPreset={(p) => void applyPreset(p)}
          onReset={() => void applyPreset("standaard", true)}
          onToggleMaximize={() => model && toggleMaximizePreview(model)}
          onCloseProject={props.onCloseProject}
          onShortcuts={() => setToonSneltoetsen(true)}
        />
        <div className="flex min-h-0 flex-1">
          <WorkspaceMenu
            projectNaam={project.naam}
            signalen={signalen}
            vlaggen={vlaggen}
            status={menuStatus(signalen)}
            actief={actief}
            ingeklapt={settings.menu_collapsed || smalVenster}
            onToggleIngeklapt={() => void setSetting("menu_collapsed", !settings.menu_collapsed)}
            onOpen={openPaneel}
            onHome={props.onHome}
            onVoegToe={(id) => void voegToe(id)}
          />
          <div ref={host} onKeyDownCapture={onGripKey} className="studio-layout relative min-h-0 min-w-0 flex-1" data-compact={isCompactView ? "ja" : "nee"} aria-label={t("werkruimte.label")} role="region">
            {model ? (
              <Layout
                model={model}
                factory={factory}
                onRenderTab={onRenderTab}
                onRenderTabSet={onRenderTabSet}
                onModelChange={onModelChange}
                keyMap={{ focusTabToggle: "F6", focusNextTabset: "Ctrl+]", focusPreviousTabset: "Ctrl+[" }}
                i18nTranslator={i18nTranslator}
              />
            ) : (
              <div role="status" aria-label={t("werkruimte.laden")} className="space-y-3 p-6">
                <Skeleton className="h-10 w-1/3" />
                <Skeleton className="h-64 w-full" />
              </div>
            )}
          </div>
        </div>
        {toonSneltoetsen && <ShortcutsDialog onClose={() => setToonSneltoetsen(false)} />}
      </div>
    </WorkspaceProvider>
  );
}

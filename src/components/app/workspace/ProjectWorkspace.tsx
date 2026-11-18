import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Layout,
  Model,
  type TabNode,
  type TabSetNode,
  type BorderNode,
  type ITabRenderValues,
  type ITabSetRenderValues,
} from "flexlayout-react";
import "flexlayout-react/style/light.css";
import {
  layoutGet,
  layoutReset,
  layoutSet,
  type Account,
  type McpInfo,
  type PreviewInfo,
  type Project,
} from "@/lib/api";
import {
  compacteIndeling,
  isPanelId,
  LayoutService,
  PANEL_IDS,
  type PanelId,
  type PresetId,
} from "@/lib/layout";
import ChatPanel from "@/components/app/chat/ChatPanel";
import PublishPanel from "@/components/app/PublishPanel";
import AccountsScreen from "@/components/AccountsScreen";
import AppearancePanel from "@/components/kits/AppearancePanel";
import PreviewPanel from "@/components/PreviewPanel";
import TerminalPanel, { type Session } from "@/components/TerminalPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import EigenschappenPanel from "./panels/EigenschappenPanel";
import HistoryPanel from "./panels/HistoryPanel";
import PlaceholderPanel from "./panels/PlaceholderPanel";
import type { PageInfo, PickedElement, PreviewControl } from "./pick";
import ProjectSettingsPanel, {
  type SettingsProps,
} from "./panels/ProjectSettingsPanel";
import StructuurPanel from "./panels/StructuurPanel";
import MovePanelMenu from "./MovePanelMenu";
import SectionRail from "./SectionRail";
import ShortcutsDialog from "./ShortcutsDialog";
import WorkspaceBar from "./WorkspaceBar";
import { ICONEN } from "./sections";
import {
  closePanel,
  geefRuimteAanEigenschappen,
  isOpen,
  isPreviewMaximized,
  openIds,
  openPanel,
  toggleMaximizePreview,
  togglePanel,
} from "./modelActions";

/** Onder deze breedte (in CSS-pixels) toont de werkruimte een compacte indeling met tabbladen. */
export const COMPACT_BREEDTE = 1000;

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
  settings: SettingsProps;
  /** Een verzoek van buiten om een paneel te tonen (bijvoorbeeld de preview zodra er iets te zien is). `nonce` maakt elk verzoek nieuw. */
  request: { id: PanelId; nonce: number } | null;
  onSessionsChange: (updater: (prev: Session[]) => Session[]) => void;
  onError: (msg: string) => void;
  onRetryMcp: () => Promise<void> | void;
  onDefaultAccount: (accountId: number | null) => void | Promise<void>;
  onAccountsChanged: () => void | Promise<void>;
  onHome: () => void;
  onCloseProject: () => void;
}

/** De werkruimte van één project: iconenbalk links, daarnaast een indeling van panelen die je kunt verschuiven en vergroten. */
export default function ProjectWorkspace(props: Props) {
  const { project, accounts, sessions, mcp, preview, onError } = props;
  const { t } = useTranslation();
  const [normal, setNormal] = useState<Model | null>(null);
  const [compact, setCompact] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const host = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<PickedElement | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const control = useRef<PreviewControl | null>(null);
  const [toonSneltoetsen, setToonSneltoetsen] = useState(false);
  const normalRef = useRef<Model | null>(null);

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
    const meet = () =>
      setCompact(el.clientWidth > 0 && el.clientWidth < COMPACT_BREEDTE);
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

  // Sneltoetsen: Ctrl (of Cmd) + Shift + G/E/L/M. Geen Alt, want dat is op veel toetsenborden de AltGr-toets.
  useEffect(() => {
    if (!model) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        e.preventDefault();
        openPanel(model, "chat");
        setTimeout(() => document.getElementById("chat-input")?.focus(), 60);
      } else if (k === "e") {
        e.preventDefault();
        if (isOpen(model, "eigenschappen")) closePanel(model, "eigenschappen");
        else openPanel(model, "eigenschappen");
      } else if (k === "l") {
        e.preventDefault();
        if (isOpen(model, "structuur")) closePanel(model, "structuur");
        else openPanel(model, "structuur");
      } else if (k === "m") {
        e.preventDefault();
        toggleMaximizePreview(model);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model]);

  // Een paneel vanzelf naar voren halen als de rest van de app daarom vraagt.
  const verwerkt = useRef(props.request?.nonce ?? 0);
  useEffect(() => {
    const r = props.request;
    if (!model || !r || r.nonce === verwerkt.current) return;
    verwerkt.current = r.nonce;
    openPanel(model, r.id);
  }, [props.request, model]);

  const open = model ? openIds(model, PANEL_IDS) : new Set<PanelId>();

  const openSection = useCallback(
    (id: PanelId) => {
      if (model) openPanel(model, id);
    },
    [model],
  );

  async function applyPreset(preset: PresetId, melding = false) {
    const j = await service.reset(project.id, preset);
    const m = Model.fromJson(j);
    normalRef.current = m;
    setNormal(m);
    service.save(project.id, m.toJson());
    if (melding) toast.success(t("werkruimte.balk.herstelKlaar"));
  }

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
            onOpenAdvanced={() => openSection("geavanceerd")}
            onOpenAccounts={() => openSection("accounts")}
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
      case "geavanceerd":
        return (
          <TerminalPanel
            project={project}
            accounts={accounts}
            sessions={sessions}
            mcp={mcp}
            onSessionsChange={props.onSessionsChange}
            onError={onError}
            onRetryMcp={props.onRetryMcp}
          />
        );
      case "uiterlijk":
        return (
          <ScrollArea className="h-full">
            <AppearancePanel
              key={project.id}
              projectId={project.id}
              firstRun={project.template !== "leeg"}
              onError={onError}
            />
          </ScrollArea>
        );
      case "publiceren":
        return <PublishPanel project={project} onError={onError} />;
      case "accounts":
        return (
          <ScrollArea className="h-full">
            <AccountsScreen
              accounts={accounts}
              onChanged={props.onAccountsChanged}
              onError={onError}
            />
          </ScrollArea>
        );
      case "instellingen":
        return (
          <ProjectSettingsPanel
            project={project}
            accounts={accounts}
            onDefaultAccount={props.onDefaultAccount}
            {...props.settings}
          />
        );
      case "geschiedenis":
        return (
          <HistoryPanel
            project={project}
            mcp={mcp}
            tick={props.tick}
            onError={onError}
          />
        );
      case "structuur":
        return <StructuurPanel selection={selection} />;
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
      case "componenten":
      case "database":
      case "koppelingen":
        return (
          <PlaceholderPanel id={id} projectId={project.id} onError={onError} />
        );
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="workspace">
      <WorkspaceBar
        naam={project.naam}
        mcp={mcp}
        preview={preview}
        maximized={model ? isPreviewMaximized(model) : false}
        onHome={props.onHome}
        onPreset={(p) => void applyPreset(p)}
        onReset={() => void applyPreset("standaard", true)}
        onToggleMaximize={() => model && toggleMaximizePreview(model)}
        onCloseProject={props.onCloseProject}
        onShortcuts={() => setToonSneltoetsen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <SectionRail
          open={open}
          onToggle={(id) => model && togglePanel(model, id)}
        />
        <div
          ref={host}
          onKeyDownCapture={onGripKey}
          className="studio-layout relative min-h-0 min-w-0 flex-1"
          data-compact={isCompactView ? "ja" : "nee"}
          aria-label={t("werkruimte.label")}
          role="region"
        >
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
            <div
              role="status"
              aria-label={t("werkruimte.laden")}
              className="space-y-3 p-6"
            >
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </div>
      </div>
      {toonSneltoetsen && <ShortcutsDialog onClose={() => setToonSneltoetsen(false)} />}
    </div>
  );
}

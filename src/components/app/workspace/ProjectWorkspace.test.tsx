import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import { defaultLayout, LAYOUT_VERSION } from "@/lib/layout";
import ProjectWorkspace from "./ProjectWorkspace";
import { SettingsProvider } from "@/components/app/settings-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/api");
vi.mock("@/components/app/chat/ChatPanel", () => ({ default: () => <div data-testid="chat">chat</div> }));
vi.mock("@/components/PreviewPanel", () => ({ default: () => <div data-testid="preview">preview</div> }));
vi.mock("@/components/TerminalPanel", () => ({ default: () => <div data-testid="terminal">terminal</div> }));
vi.mock("@/components/kits/AppearancePanel", () => ({ default: () => <div data-testid="uiterlijk">uiterlijk</div> }));
vi.mock("@/components/ActivityPanel", () => ({ default: () => <div data-testid="activity">activity</div> }));
vi.mock("@/components/AccountsScreen", () => ({ default: () => <div data-testid="accounts">accounts</div> }));
vi.mock("@/components/app/PublishPanel", () => ({ default: () => <div data-testid="publiceren">publiceren</div> }));

const project = { id: 7, naam: "Hovenier Joke", pad: "/p/joke", template: "leeg", created_at: "2026-01-01", default_account_id: null, last_used_at: null };
const leegSignaal = { project_md_ingevuld: false, needs_data: false, needs_data_reden: null, heeft_database: false, aantal_assets: 0 };

function setup(extra: Partial<React.ComponentProps<typeof ProjectWorkspace>> = {}) {
  const props = {
    project,
    accounts: [],
    sessions: [],
    mcp: { state: "connected", port: 1, error: null } as never,
    preview: { status: "running" } as never,
    reloadNonce: 0,
    autoSwitch: false,
    onAutoSwitch: vi.fn(),
    technical: false,
    tick: 0,
    request: null,
    onSessionsChange: vi.fn(),
    onError: vi.fn(),
    onRetryMcp: vi.fn(),
    onDefaultAccount: vi.fn(),
    onAccountsChanged: vi.fn(),
    onHome: vi.fn(),
    onCloseProject: vi.fn(),
    onRenamed: vi.fn(),
    onRemove: vi.fn(),
    ...extra,
  };
  const r = render(
    <TooltipProvider>
      <SettingsProvider>
        <ProjectWorkspace {...props} />
      </SettingsProvider>
    </TooltipProvider>,
  );
  return { ...props, ...r };
}

// jsdom kent geen echte afmetingen; flexlayout tekent niets zonder. We doen alsof alles 1200 × 800 px is.
const rect = { x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) };
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
  (api.layoutGet as Mock).mockResolvedValue(null);
  (api.layoutSet as Mock).mockResolvedValue(undefined);
  (api.layoutReset as Mock).mockResolvedValue(undefined);
  (api.getUiSetting as Mock).mockResolvedValue(null);
  (api.setUiSetting as Mock).mockResolvedValue(undefined);
  (api.resetUiSetting as Mock).mockResolvedValue(undefined);
  (api.projectSignals as Mock).mockResolvedValue(leegSignaal);
  (api.projectDescriptionGet as Mock).mockResolvedValue("");
  (api.projectFlags as Mock).mockResolvedValue({});
  (api.projectFlagSet as Mock).mockResolvedValue(undefined);
  (api.chatHistory as Mock).mockResolvedValue([]);
  (api.runtime as Mock).mockResolvedValue([]);
  (api.lastChecks as Mock).mockResolvedValue([]);
  (api.kitCurrent as Mock).mockResolvedValue({ kit: null });
  (api.projectPages as Mock).mockResolvedValue([]);
  (api.assetsList as Mock).mockResolvedValue([]);
});

describe("Werkruimte: menu", () => {
  it("toont terug, projectnaam, Hulp en de drie groepen met acht onderdelen; Gegevens en 'Voor gevorderden' zijn dicht", async () => {
    setup();
    const menu = await screen.findByTestId("menu");
    expect(within(menu).getByTestId("menu-terug")).toHaveTextContent("Alle projecten");
    expect(within(menu).getByRole("heading", { name: "Hovenier Joke" })).toBeInTheDocument();
    expect(within(menu).getByTestId("menu-hulp")).toBeInTheDocument();
    for (const g of ["Maken", "Delen", "Beheer"]) expect(within(menu).getByRole("group", { name: g })).toBeInTheDocument();
    const items = within(menu).getAllByRole("button").filter((b) => b.dataset.testid?.startsWith("menu-") && !["menu-terug", "menu-hulp", "menu-klap", "menu-meer", "menu-gevorderd"].includes(b.dataset.testid!));
    expect(items.map((b) => b.dataset.testid)).toEqual(["menu-start", "menu-schermen", "menu-uiterlijk", "menu-bestanden", "menu-onlinezetten", "menu-appwinkel", "menu-versies", "menu-instellingen"]);
    expect(screen.queryByTestId("menu-gegevens")).not.toBeInTheDocument();
    expect(screen.queryByTestId("menu-terminal")).not.toBeInTheDocument();
    expect(within(menu).getByText("Voor gevorderden")).toBeInTheDocument();
  });

  it("Voor gevorderden klapt open en toont Terminal, Logs, Technische status en Code en bestanden, met korte uitleg", async () => {
    setup();
    fireEvent.click(await screen.findByTestId("menu-gevorderd"));
    for (const id of ["terminal", "logs", "technischestatus", "code"]) expect(await screen.findByTestId(`menu-${id}`)).toBeInTheDocument();
    expect(screen.getByText(/Beginners hebben dit niet nodig/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-terminal"));
    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
  });

  it("'Alle projecten' brengt je terug naar het homescherm", async () => {
    const { onHome } = setup();
    fireEvent.click(await screen.findByTestId("menu-terug"));
    expect(onHome).toHaveBeenCalled();
  });

  it("het menu klapt in tot iconen met schermlezerlabels en weer uit", async () => {
    setup();
    const menu = await screen.findByTestId("menu");
    expect(menu).toHaveAttribute("data-ingeklapt", "nee");
    fireEvent.click(screen.getByTestId("menu-klap"));
    await waitFor(() => expect(menu).toHaveAttribute("data-ingeklapt", "ja"));
    expect(screen.getByTestId("menu-start")).toHaveAccessibleName("Start openen");
    expect(screen.getByTestId("menu-terug")).toHaveAccessibleName("Alle projecten");
    expect(api.setUiSetting).toHaveBeenCalledWith("menu_collapsed", "1");
    fireEvent.click(screen.getByTestId("menu-klap"));
    await waitFor(() => expect(menu).toHaveAttribute("data-ingeklapt", "nee"));
  });

  it("menu-items openen hun paneel en markeren het als huidige pagina", async () => {
    setup();
    await screen.findByTestId("chat");
    expect(screen.getByTestId("menu-start")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByTestId("menu-onlinezetten"));
    expect(await screen.findByText("Checklist")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("menu-onlinezetten")).toHaveAttribute("aria-current", "page"));
    fireEvent.click(screen.getByTestId("menu-versies"));
    expect(await screen.findByTestId("activity")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-appwinkel"));
    expect(await screen.findByText("Dit heb je straks nodig")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-hulp"));
    expect(await screen.findByText("Zo werkt het")).toBeInTheDocument();
  });

  it("accountbeheer en instellingen zijn bereikbaar via Instellingen", async () => {
    setup();
    await screen.findByTestId("chat");
    fireEvent.click(screen.getByTestId("menu-instellingen"));
    expect(await screen.findByTestId("instellingen")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mijn project" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mijn AI" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mijn programma" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Voor gevorderden" })).toBeInTheDocument();
  });
});

describe("Werkruimte: voortgang en status", () => {
  it("Start toont de vier stappen en 'Volgende stap' wijst naar het idee in een nieuw project", async () => {
    setup();
    const lijst = await screen.findByTestId("stappen");
    expect(within(lijst).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByTestId("volgende-stap")).toHaveTextContent("Volgende stap: Beschrijf je idee");
  });

  it("de stappen volgen het project: opdracht gegeven, versies opgeslagen en online gezet", async () => {
    (api.chatHistory as Mock).mockResolvedValue([{ id: 1, kind: "user", payload: {}, project_id: 7, created_at: "" }]);
    (api.runtime as Mock).mockResolvedValue([{ hash: "a" }, { hash: "b" }]);
    (api.projectFlags as Mock).mockResolvedValue({ online_gezet: "1" });
    setup();
    await waitFor(() => expect(screen.getByText("Alles gedaan!")).toBeInTheDocument());
    for (const li of within(screen.getByTestId("stappen")).getAllByRole("listitem")) expect(li).toHaveAttribute("data-klaar", "ja");
    expect(screen.queryByTestId("volgende-stap")).not.toBeInTheDocument();
  });

  it("statusbolletjes en aantallen komen uit het project", async () => {
    (api.kitCurrent as Mock).mockResolvedValue({ kit: { kit: "shadcn" } });
    (api.runtime as Mock).mockResolvedValue([{ hash: "a" }, { hash: "b" }, { hash: "c" }]);
    (api.lastChecks as Mock).mockResolvedValue([{ id: 1, ok: false, steps: [], created_at: "" }]);
    (api.projectSignals as Mock).mockResolvedValue({ ...leegSignaal, aantal_assets: 2 });
    setup();
    await waitFor(() => expect(within(screen.getByTestId("menu-uiterlijk")).getByTestId("punt-klaar")).toBeInTheDocument());
    expect(within(screen.getByTestId("menu-onlinezetten")).getByTestId("punt-actie")).toBeInTheDocument();
    expect(within(screen.getByTestId("menu-versies")).getByLabelText("3 stuks")).toBeInTheDocument();
    expect(within(screen.getByTestId("menu-bestanden")).getByLabelText("2 stuks")).toBeInTheDocument();
  });
});

describe("Werkruimte: Gegevens en 'Meer onderdelen'", () => {
  it("Gegevens verschijnt als de AI opslag nodig vindt", async () => {
    (api.projectSignals as Mock).mockResolvedValue({ ...leegSignaal, needs_data: true, needs_data_reden: "Bestellingen bewaren" });
    setup();
    expect(await screen.findByTestId("menu-gegevens")).toBeInTheDocument();
    expect(within(screen.getByTestId("menu-gegevens")).getByTestId("punt-actie")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-meer")).not.toBeInTheDocument();
  });

  it("'Meer onderdelen' laat de gebruiker Gegevens zelf toevoegen", async () => {
    setup();
    await screen.findByTestId("chat");
    expect(screen.queryByTestId("menu-gegevens")).not.toBeInTheDocument();
    fireEvent.pointerDown(await screen.findByTestId("menu-meer"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Wat je app onthoudt" }));
    await waitFor(() => expect(api.projectFlagSet).toHaveBeenCalledWith(7, "gegevens_aan", "1"));
  });
});

describe("Werkruimte: indeling en bovenbalk", () => {
  it("toont de bovenbalk met status en de standaardpanelen (chat, voorbeeld, eigenschappen, start)", async () => {
    setup();
    expect(await screen.findByTestId("chat")).toBeInTheDocument();
    expect(screen.getByTestId("preview")).toBeInTheDocument();
    expect(screen.getByTestId("status-preview")).toHaveTextContent("Voorbeeld: Draait");
    expect(screen.getByTestId("status-mcp")).toHaveTextContent("AI-koppeling: verbonden");
    expect(await screen.findByText("Zo kom je stap voor stap van idee naar een website of app die online staat.")).toBeInTheDocument();
  });

  it("een gewijzigde indeling wordt (na een korte pauze) per project opgeslagen", async () => {
    setup();
    await screen.findByTestId("chat");
    fireEvent.click(screen.getByTestId("menu-bestanden"));
    await waitFor(() => expect(api.layoutSet).toHaveBeenCalled(), { timeout: 2000 });
    const [id, versie, json] = (api.layoutSet as Mock).mock.calls.at(-1)!;
    expect(id).toBe(7);
    expect(versie).toBe(LAYOUT_VERSION);
    expect(json).toContain('"bestanden"');
  });

  it("een opgeslagen indeling wordt hersteld", async () => {
    const j = defaultLayout();
    (j.layout.children![0] as { children: { component: string; id: string; name: string; type: string }[] }).children = [{ type: "tab", id: "bestanden", component: "bestanden", name: "x" }];
    (api.layoutGet as Mock).mockResolvedValue({ versie: LAYOUT_VERSION, json: JSON.stringify(j) });
    setup();
    await screen.findByTestId("chat");
    expect(await screen.findByTestId("bestanden")).toBeInTheDocument();
    expect(screen.queryByTestId("stappen")).not.toBeInTheDocument();
  });

  it("een kapotte of te nieuwe opgeslagen indeling blokkeert niets: de standaardindeling verschijnt", async () => {
    (api.layoutGet as Mock).mockResolvedValue({ versie: LAYOUT_VERSION, json: "{kapot" });
    setup();
    expect(await screen.findByTestId("chat")).toBeInTheDocument();
    expect(await screen.findByTestId("stappen")).toBeInTheDocument();
  });

  it("een oude indeling (versie 1) wordt omgezet naar het nieuwe menu", async () => {
    const v1 = JSON.parse(JSON.stringify(defaultLayout()));
    v1.layout.children[0].children = [{ type: "tab", id: "structuur", component: "structuur" }];
    v1.layout.children[1].children.push({ type: "tab", id: "publiceren", component: "publiceren" });
    (api.layoutGet as Mock).mockResolvedValue({ versie: 1, json: JSON.stringify(v1) });
    setup();
    await screen.findByTestId("chat");
    expect(await screen.findByTestId("lege-staat")).toBeInTheDocument(); // Schermen is leeg
    expect(api.layoutReset).not.toHaveBeenCalled();
  });

  it("als de database niet te lezen is, werkt de werkruimte toch met de standaardindeling", async () => {
    (api.layoutGet as Mock).mockRejectedValue(new Error("db weg"));
    setup();
    expect(await screen.findByTestId("chat")).toBeInTheDocument();
  });

  it("sneltoetsen: Ctrl+Shift+S naar Start, Ctrl+Shift+E Eigenschappen, Ctrl+Shift+L het menu", async () => {
    setup();
    await screen.findByTestId("chat");
    fireEvent.click(screen.getByTestId("menu-bestanden"));
    await screen.findByTestId("bestanden");
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByTestId("menu-start")).toHaveAttribute("aria-current", "page"));
    const uitleg = () => screen.queryByText(/Kies in het voorbeeld een onderdeel van je pagina/);
    fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(uitleg()).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: "L", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByTestId("menu")).toHaveAttribute("data-ingeklapt", "ja"));
    fireEvent.keyDown(window, { key: "L", ctrlKey: true });
    expect(screen.getByTestId("menu")).toHaveAttribute("data-ingeklapt", "ja");
  });

  it("het menu Meer heeft Sneltoetsen en Project sluiten", async () => {
    const { onCloseProject } = setup();
    await screen.findByTestId("chat");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Meer" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sneltoetsen" }));
    expect(await screen.findByText("Naar het gesprek (typen)")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Sluiten" })[0]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Meer" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Project sluiten" }));
    expect(onCloseProject).toHaveBeenCalled();
  });
});

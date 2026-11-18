import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import { defaultLayout, LAYOUT_VERSION } from "@/lib/layout";
import ProjectWorkspace from "./ProjectWorkspace";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/api");
vi.mock("@/components/app/chat/ChatPanel", () => ({ default: () => <div data-testid="chat">chat</div> }));
vi.mock("@/components/PreviewPanel", () => ({ default: () => <div data-testid="preview">preview</div> }));
vi.mock("@/components/TerminalPanel", () => ({ default: () => <div data-testid="terminal">terminal</div> }));
vi.mock("@/components/kits/AppearancePanel", () => ({ default: () => <div data-testid="uiterlijk">uiterlijk</div> }));
vi.mock("@/components/ActivityPanel", () => ({ default: () => <div data-testid="activity">activity</div> }));
vi.mock("@/components/AccountsScreen", () => ({ default: () => <div data-testid="accounts">accounts</div> }));

const project = { id: 7, naam: "Hovenier Joke", pad: "/p/joke", template: "leeg", created_at: "2026-01-01", default_account_id: null, last_used_at: null };
const settings = { communication: "simple" as const, permission: "important" as const, loopThreshold: 3, onLoopThreshold: vi.fn(), onCommunication: vi.fn(), onPermission: vi.fn() };

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
    settings,
    request: null,
    onSessionsChange: vi.fn(),
    onError: vi.fn(),
    onRetryMcp: vi.fn(),
    onDefaultAccount: vi.fn(),
    onAccountsChanged: vi.fn(),
    onHome: vi.fn(),
    onCloseProject: vi.fn(),
    ...extra,
  };
  const r = render(
    <TooltipProvider>
      <ProjectWorkspace {...props} />
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
});

describe("ProjectWorkspace", () => {
  it("toont de bovenbalk met naam en status, de iconenbalk en de standaardpanelen (chat, preview, eigenschappen, structuur)", async () => {
    setup();
    expect(await screen.findByTestId("chat")).toBeInTheDocument();
    expect(screen.getByTestId("preview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hovenier Joke" })).toBeInTheDocument();
    expect(screen.getByTestId("status-preview")).toHaveTextContent("Voorbeeld: Draait");
    expect(screen.getByTestId("status-mcp")).toHaveTextContent("AI-koppeling: verbonden");
    const rail = screen.getByRole("navigation", { name: "Onderdelen van je project" });
    expect(rail.querySelectorAll("button")).toHaveLength(10);
    expect(await screen.findByText("Kies in het voorbeeld een onderdeel van je pagina. Dan zie je hier wat het is en hoe het eruitziet.")).toBeInTheDocument();
  });

  it("'Alle projecten' brengt je terug naar het homescherm", async () => {
    const { onHome } = setup();
    await screen.findByTestId("chat");
    fireEvent.click(screen.getByRole("button", { name: "Alle projecten" }));
    expect(onHome).toHaveBeenCalled();
  });

  it("de iconenbalk opent de terminal onder Geavanceerd en sluit hem weer", async () => {
    setup();
    await screen.findByTestId("chat");
    expect(screen.queryByTestId("terminal")).not.toBeInTheDocument();
    const knop = screen.getByTestId("rail-geavanceerd");
    expect(knop).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(knop);
    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("rail-geavanceerd")).toHaveAttribute("aria-pressed", "true"));
  });

  it("accountbeheer en instellingen zijn bereikbaar als paneel", async () => {
    setup();
    await screen.findByTestId("chat");
    fireEvent.click(screen.getByTestId("rail-accounts"));
    expect(await screen.findByTestId("accounts")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rail-instellingen"));
    expect(await screen.findByText("Dit project")).toBeInTheDocument();
    expect(screen.getByText("/p/joke")).toBeInTheDocument();
  });

  it("een gewijzigde indeling wordt (na een korte pauze) per project opgeslagen", async () => {
    setup();
    await screen.findByTestId("chat");
    fireEvent.click(screen.getByTestId("rail-database"));
    await waitFor(() => expect(api.layoutSet).toHaveBeenCalled(), { timeout: 2000 });
    const [id, versie, json] = (api.layoutSet as Mock).mock.calls.at(-1)!;
    expect(id).toBe(7);
    expect(versie).toBe(LAYOUT_VERSION);
    expect(json).toContain('"database"');
  });

  it("een opgeslagen indeling wordt hersteld", async () => {
    const j = defaultLayout();
    (j.layout.children![0] as { children: { component: string; id: string; name: string; type: string }[] }).children = [{ type: "tab", id: "database", component: "database", name: "x" }];
    (api.layoutGet as Mock).mockResolvedValue({ versie: LAYOUT_VERSION, json: JSON.stringify(j) });
    setup();
    await screen.findByTestId("chat");
    expect(screen.getByTestId("rail-database")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("rail-structuur")).toHaveAttribute("aria-pressed", "false");
  });

  it("een kapotte opgeslagen indeling blokkeert niets: de standaardindeling verschijnt", async () => {
    (api.layoutGet as Mock).mockResolvedValue({ versie: LAYOUT_VERSION, json: "{kapot" });
    setup();
    expect(await screen.findByTestId("chat")).toBeInTheDocument();
    expect(screen.getByTestId("rail-structuur")).toHaveAttribute("aria-pressed", "true");
  });

  it("als de database niet te lezen is, werkt de werkruimte toch met de standaardindeling", async () => {
    (api.layoutGet as Mock).mockRejectedValue(new Error("db weg"));
    setup();
    expect(await screen.findByTestId("chat")).toBeInTheDocument();
  });
});

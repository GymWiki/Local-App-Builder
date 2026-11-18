import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import EersteStart from "./EersteStart";
import Systeemcheck from "./Systeemcheck";

vi.mock("@/lib/api");
vi.mock("@/components/LoginModal", () => ({ default: ({ account }: { account: { provider: string } }) => <div data-testid="login-modal">{account.provider}</div> }));
const zetSetting = vi.fn(async () => undefined);
let instellingen = { permission_mode: "important", eerste_start_klaar: false };
let geladen = true;
vi.mock("@/components/app/settings-provider", () => ({ useSettings: () => ({ settings: instellingen, geladen, set: zetSetting }) }));

const rapport = (over: object = {}) => ({ klaar: true, punten: [{ id: "node", status: "ok", detail: "v22" }, { id: "git", status: "ok", detail: "git 2" }, { id: "ai", status: "ok", detail: "claude" }, { id: "internet", status: "ok", detail: null }, { id: "schijf", status: "ok", detail: "50" }, { id: "rechten", status: "ok", detail: null }], ...over });

beforeEach(() => {
  vi.resetAllMocks();
  zetSetting.mockResolvedValue(undefined);
  instellingen = { permission_mode: "important", eerste_start_klaar: false };
  geladen = true;
  (api.systemCheck as Mock).mockResolvedValue(rapport());
  (api.listAccounts as Mock).mockResolvedValue([]);
});

describe("EersteStart", () => {
  it("toont drie stappen met welkom in twee zinnen, AI kiezen en bedieningsniveau", async () => {
    render(<EersteStart />);
    expect(screen.getByTestId("eerste-stap")).toHaveTextContent("Stap 1 van 3");
    expect(screen.getByTestId("eerste-welkom")).toHaveTextContent("verstuurt zelf niets");
    fireEvent.click(screen.getByTestId("eerste-volgende"));
    expect(await screen.findByTestId("eerste-ai")).toHaveTextContent("Claude");
    expect(screen.getByTestId("eerste-ai")).toHaveTextContent("Codex komt later");
    expect(await screen.findByTestId("systeemcheck")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eerste-volgende"));
    for (const t of ["Ik wil het zelf bepalen", "Vraag me bij belangrijke dingen", "Laat de AI zijn gang gaan"]) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Vraag me bij belangrijke dingen/ })).toBeChecked();
  });

  it("de gekozen stand wordt bewaard en daarna verdwijnt het scherm; 'Laat de AI zijn gang gaan' toont een waarschuwing", async () => {
    render(<EersteStart />);
    fireEvent.click(screen.getByTestId("eerste-volgende"));
    fireEvent.click(screen.getByTestId("eerste-volgende"));
    expect(screen.queryByTestId("eerste-waarschuwing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Laat de AI zijn gang gaan/ }));
    expect(screen.getByTestId("eerste-waarschuwing")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eerste-klaar"));
    await waitFor(() => expect(zetSetting).toHaveBeenCalledWith("permission_mode", "autonomous"));
    expect(zetSetting).toHaveBeenCalledWith("eerste_start_klaar", true);
  });

  it("'Later doen' slaat alles over zonder het niveau te wijzigen", async () => {
    render(<EersteStart />);
    fireEvent.click(screen.getByTestId("eerste-later"));
    await waitFor(() => expect(zetSetting).toHaveBeenCalledWith("eerste_start_klaar", true));
    expect(zetSetting).not.toHaveBeenCalledWith("permission_mode", expect.anything());
  });

  it("inloggen maakt zo nodig een account en opent het inlogvenster", async () => {
    (api.createAccount as Mock).mockResolvedValue({ id: 1, provider: "claude", label: "Mijn account", profile_dir: "", created_at: "" });
    render(<EersteStart />);
    fireEvent.click(screen.getByTestId("eerste-volgende"));
    fireEvent.click(await screen.findByTestId("eerste-login-claude"));
    expect(await screen.findByTestId("login-modal")).toHaveTextContent("claude");
    expect(api.createAccount).toHaveBeenCalledWith("claude", "Mijn account");
  });

  it("toont niets als de eerste start al is gedaan of de instellingen nog niet gelezen zijn", () => {
    instellingen = { permission_mode: "important", eerste_start_klaar: true };
    const { container, rerender } = render(<EersteStart />);
    expect(container).toBeEmptyDOMElement();
    instellingen = { permission_mode: "important", eerste_start_klaar: false };
    geladen = false;
    rerender(<EersteStart />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Systeemcheck", () => {
  it("legt in gewone taal uit wat ontbreekt en biedt een downloadknop; een storing in de check blokkeert niets", async () => {
    (api.systemCheck as Mock).mockResolvedValue(rapport({ klaar: false, punten: [{ id: "node", status: "fout", detail: "node_missing" }, { id: "git", status: "ok", detail: "git 2" }, { id: "ai", status: "ok", detail: "claude" }, { id: "internet", status: "let_op", detail: null }, { id: "schijf", status: "ok", detail: "50" }, { id: "rechten", status: "ok", detail: null }] }));
    render(<Systeemcheck />);
    const node = await screen.findByText("Een hulpprogramma voor Studio (Node.js)");
    expect(node.closest("li")).toHaveAttribute("data-status", "fout");
    expect(screen.getByTestId("systeem-samenvatting")).toHaveAttribute("data-klaar", "nee");
    fireEvent.click(screen.getByTestId("systeem-open-node"));
    expect(api.connectOpen).toHaveBeenCalledWith("https://nodejs.org/en/download");
    expect(screen.getByText(/Geen verbinding gevonden/)).toBeInTheDocument();
    (api.systemCheck as Mock).mockRejectedValue("kapot");
    fireEvent.click(screen.getByTestId("systeem-opnieuw"));
    await waitFor(() => expect(screen.getByTestId("systeem-opnieuw")).toBeEnabled());
  });

  it("alles in orde geeft één rustige zin", async () => {
    render(<Systeemcheck />);
    expect(await screen.findByText("Alles is klaar.")).toBeInTheDocument();
  });
});

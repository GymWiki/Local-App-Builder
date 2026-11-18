import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { GhState } from "@/lib/api";
import { ConnectionsProvider } from "@/components/app/connect/connections-provider";
import ActieBevestig from "@/components/app/ActieBevestig";
import GithubBackup from "./GithubBackup";

vi.mock("@/lib/api");
const handlers: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers[name] = cb;
    return () => undefined;
  }),
}));
const stuur = (naam: string, payload: unknown) => act(async () => handlers[naam]?.({ payload }));

const link = { eigenaar: "pieter", repo: "mijn-app", privaat: true, url: "https://github.com/pieter/mijn-app", tak: "main", laatste: null, laatste_aantal: null, auto: false, ai_vraagt: true, uiteengelopen: null, probleem: null } as const;
const staat = (over: Partial<GhState> = {}): GhState => ({ werkt: true, account: "pieter", link: null, versies: 2, nieuw: 0, bezig: false, ...over });
const toon = () =>
  render(
    <ConnectionsProvider>
      <GithubBackup projectId={1} />
    </ConnectionsProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  (api.connectList as Mock).mockResolvedValue([]);
  (api.githubState as Mock).mockResolvedValue(staat());
  (api.githubSuggestName as Mock).mockResolvedValue({ naam: "mijn-app", geldig: true, vrij: true });
});

describe("GithubBackup", () => {
  it("toont de Verbinden-knop als GitHub nog niet gekoppeld is", async () => {
    (api.githubState as Mock).mockResolvedValue(staat({ werkt: false, account: null }));
    toon();
    expect(await screen.findByTestId("verbind-github")).toBeInTheDocument();
    expect(screen.queryByTestId("github-eerste")).not.toBeInTheDocument();
  });

  it("eerste keer: privé is standaard en een naam wordt voorgesteld en gecontroleerd", async () => {
    toon();
    const naam = (await screen.findByTestId("github-naam")) as HTMLInputElement;
    await waitFor(() => expect(naam.value).toBe("mijn-app"));
    expect(screen.getByTestId("github-naam-status")).toHaveTextContent("nog vrij");
    expect(screen.getByRole("radio", { name: /Privé/ })).toBeChecked();
    (api.githubFirstBackup as Mock).mockResolvedValue({ status: "uitgevoerd", code: "back_up_klaar", params: { aantal: 2 } });
    fireEvent.click(screen.getByTestId("github-maak"));
    await waitFor(() => expect(api.githubFirstBackup).toHaveBeenCalledWith(1, "mijn-app", false, false));
    expect(await screen.findByTestId("github-uitkomst")).toHaveTextContent("Back-up bijgewerkt: 2 nieuwe versies");
  });

  it("een bezette naam blokkeert de knop met een duidelijke tekst", async () => {
    (api.githubSuggestName as Mock).mockResolvedValue({ naam: "mijn-app", geldig: true, vrij: false });
    toon();
    await screen.findByTestId("github-naam");
    await waitFor(() => expect(screen.getByTestId("github-naam-status")).toHaveTextContent("al in gebruik"));
    expect(screen.getByTestId("github-maak")).toBeDisabled();
  });

  it("openbaar vraagt uitleg en een extra bevestiging voordat de knop werkt", async () => {
    toon();
    await screen.findByTestId("github-naam");
    await waitFor(() => expect(screen.getByTestId("github-maak")).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: /Openbaar/ }));
    expect(screen.getByTestId("github-openbaar-waarschuwing")).toHaveTextContent("kan iedereen je bestanden lezen");
    expect(screen.getByTestId("github-maak")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /iedereen dit kan zien/ }));
    expect(screen.getByTestId("github-maak")).toBeEnabled();
    (api.githubFirstBackup as Mock).mockResolvedValue({ status: "uitgevoerd", code: "back_up_klaar", params: { aantal: 1 } });
    fireEvent.click(screen.getByTestId("github-maak"));
    await waitFor(() => expect(api.githubFirstBackup).toHaveBeenCalledWith(1, "mijn-app", true, true));
  });

  it("gekoppeld: laatste back-up, nieuwe versies en 'Back-up bijwerken' met een duidelijke uitkomst", async () => {
    const nu = Math.floor(Date.now() / 1000);
    (api.githubState as Mock).mockResolvedValue(staat({ link: { ...link, laatste: nu - 7200, laatste_aantal: 2 }, nieuw: 3 }));
    toon();
    expect(await screen.findByTestId("github-laatste")).toHaveTextContent("Laatste back-up: 2 uur geleden");
    expect(screen.getByTestId("github-nieuw")).toHaveTextContent("3 nieuwe versies");
    (api.githubBackup as Mock).mockResolvedValue({ status: "uitgevoerd", code: "back_up_klaar", params: { aantal: 3 } });
    fireEvent.click(screen.getByTestId("github-bijwerken"));
    expect(await screen.findByTestId("github-uitkomst")).toHaveTextContent("Back-up bijgewerkt: 3 nieuwe versies.");
  });

  it("geheimen blokkeren met uitleg, en niets wordt als gelukt getoond", async () => {
    (api.githubState as Mock).mockResolvedValue(staat({ link }));
    toon();
    (api.githubBackup as Mock).mockResolvedValue({ status: "geweigerd", code: "geheimen", params: { aantal: 1 } });
    fireEvent.click(await screen.findByTestId("github-bijwerken"));
    const m = await screen.findByTestId("github-uitkomst");
    expect(m).toHaveAttribute("data-code", "geheimen");
    expect(m).toHaveTextContent("Er is niets verstuurd");
  });

  it("geblokkeerde geheimen: bestand en soort, nooit de waarde, en 'Laat de AI dit herstellen' stuurt alleen bestandsnamen", async () => {
    (api.githubState as Mock).mockResolvedValue(staat({ link }));
    const vraag = vi.fn();
    render(
      <ConnectionsProvider>
        <GithubBackup projectId={1} onVraagAi={vraag} />
      </ConnectionsProvider>,
    );
    (api.githubBackup as Mock).mockResolvedValue({ status: "geweigerd", code: "geheimen", params: { aantal: 2, bestanden: [{ bestand: ".env", regel: null, soort: "env_bestand", historie: false }, { bestand: "src/a.ts", regel: 4, soort: "github_token", historie: false }] } });
    fireEvent.click(await screen.findByTestId("github-bijwerken"));
    const lijst = await screen.findByTestId("github-vondsten");
    expect(lijst).toHaveTextContent(".env — Een .env-bestand met instellingen en geheimen");
    expect(lijst).toHaveTextContent("src/a.ts (regel 4) — Een GitHub-token");
    fireEvent.click(screen.getByTestId("github-herstel"));
    expect(vraag).toHaveBeenCalledOnce();
    expect(vraag.mock.calls[0][0]).toContain(".env, src/a.ts (regel 4)");
  });

  it("een gelukte back-up met een oude vondst toont de waarschuwing dat het niet automatisch verdwijnt", async () => {
    (api.githubState as Mock).mockResolvedValue(staat({ link }));
    toon();
    (api.githubBackup as Mock).mockResolvedValue({ status: "uitgevoerd", code: "back_up_klaar", params: { aantal: 1, waarschuwingen: [{ waarschuwing: "geheim", bestand: "oud.txt", regel: 1, soort: "github_token", historie: true }, { waarschuwing: "gitignore", aantal: 5 }] } });
    fireEvent.click(await screen.findByTestId("github-bijwerken"));
    expect(await screen.findByTestId("github-historie-waarschuwing")).toHaveTextContent("Vervang de sleutel");
    expect(screen.getByTestId("github-gitignore")).toHaveTextContent("5 regels");
  });

  it("uiteengelopen versies: uitleg met opties en niets automatisch", async () => {
    (api.githubState as Mock).mockResolvedValue(staat({ link: { ...link, uiteengelopen: "uiteengelopen" } }));
    toon();
    const a = await screen.findByTestId("github-uiteengelopen");
    expect(within(a).getByText("De versies zijn uiteengelopen")).toBeInTheDocument();
    expect(a).toHaveTextContent("Niets doen");
    expect(a).toHaveTextContent("De AI de verschillen laten samenvoegen");
  });

  it("de schakelaars voor automatisch en 'AI vraagt eerst' staan standaard uit/aan en slaan op", async () => {
    (api.githubState as Mock).mockResolvedValue(staat({ link }));
    (api.githubSetAuto as Mock).mockResolvedValue(undefined);
    toon();
    const auto = await screen.findByRole("switch", { name: /automatisch een back-up/ });
    expect(auto).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /vraagt eerst/ })).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => expect(api.githubSetAuto).toHaveBeenCalledWith(1, true));
  });
});

describe("ActieBevestig", () => {
  it("toont de vraag van de AI; 'Niet toestaan' (en Escape) antwoordt nee, 'Toestaan' ja", async () => {
    (api.actieConfirmAnswer as Mock).mockResolvedValue(true);
    render(<ActieBevestig />);
    await stuur("actie-confirm", { id: "a1", project_id: 1, soort: "github_backup", params: { repo: "pieter/mijn-app" }, zwaar: false });
    const d = await screen.findByTestId("actie-bevestig");
    expect(d).toHaveTextContent("pieter/mijn-app");
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(api.actieConfirmAnswer).toHaveBeenCalledWith("a1", false));
    await stuur("actie-confirm", { id: "a2", project_id: 1, soort: "github_backup", params: { repo: "x/y" }, zwaar: false });
    fireEvent.click(await screen.findByTestId("actie-ja"));
    await waitFor(() => expect(api.actieConfirmAnswer).toHaveBeenCalledWith("a2", true));
  });
});

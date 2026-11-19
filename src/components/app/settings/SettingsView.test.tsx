import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { Project } from "@/lib/api";
import { ThemeProvider } from "@/components/app/theme-provider";
import { SettingsProvider } from "@/components/app/settings-provider";
import SettingsView from "./SettingsView";

vi.mock("@/lib/api");

const project: Project = { id: 1, naam: "Tuinbedrijf", pad: "/p/tuin", template: "web-react-vite", created_at: "2026-01-01", default_account_id: null, last_used_at: null };

function setup(scope: "app" | "project" = "project", extra: Partial<React.ComponentProps<typeof SettingsView>> = {}) {
  const props = { scope, project: scope === "project" ? project : null, accounts: [], onAccountsChanged: vi.fn(), onDefaultAccount: vi.fn(), onError: vi.fn(), onRemove: vi.fn(), onRenamed: vi.fn(), ...extra };
  render(
    <ThemeProvider>
      <SettingsProvider>
        <SettingsView {...props} />
      </SettingsProvider>
    </ThemeProvider>,
  );
  return props;
}

beforeEach(() => {
  vi.resetAllMocks();
  (api.getUiSetting as Mock).mockResolvedValue(null);
  (api.setUiSetting as Mock).mockResolvedValue(undefined);
  (api.resetUiSetting as Mock).mockResolvedValue(undefined);
  (api.projectDescriptionGet as Mock).mockResolvedValue("");
  (api.projectDescriptionSet as Mock).mockResolvedValue(undefined);
  (api.cliStatus as Mock).mockResolvedValue({ provider: "claude", installed: true, path: "/usr/bin/claude", install_steps: [], docs_url: "" });
  (api.runtime as Mock).mockResolvedValue({ exists: false, config: null, hash: null, trusted: false });
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
});

// Radix-tabs reageren op mousedown, niet op click.
const open = (naam: string) => {
  const t = screen.getByRole("tab", { name: naam });
  fireEvent.mouseDown(t);
  fireEvent.click(t);
};
const userEvent = { click: async (el: Element) => void fireEvent.click(el) };

describe("SettingsView", () => {
  it("toont in de werkruimte vier groepen, op het startscherm geen 'Mijn project'", () => {
    setup("project");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Mijn project", "Mijn AI", "Mijn programma", "Voor gevorderden"]);
  });

  it("op het homescherm zijn er drie groepen", () => {
    setup("app");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Mijn AI", "Mijn programma", "Voor gevorderden"]);
  });

  it("elke instelling zegt of ze voor alle projecten of dit project geldt", async () => {
    setup("project");
    expect(screen.getByTestId("inst-naam-bereik")).toHaveTextContent("Alleen dit project");
    open("Mijn AI");
    expect(await screen.findByTestId("inst-toestemming-bereik")).toHaveTextContent("Voor alle projecten");
    expect(screen.getByTestId("inst-account-bereik")).toHaveTextContent("Alleen dit project");
  });

  it("toestemming: de standaard is 'Vraag bij belangrijke dingen'; 'Werk zelfstandig' toont een waarschuwing; herstellen zet terug", async () => {
    setup("project");
    open("Mijn AI");
    expect(screen.getByRole("radio", { name: /Vraag bij belangrijke dingen/ })).toBeChecked();
    expect(screen.getByTestId("inst-toestemming-herstel")).toBeDisabled();
    expect(screen.queryByTestId("waarschuwing-zelfstandig")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Werk zelfstandig/ }));
    expect(api.setUiSetting).toHaveBeenCalledWith("permission_mode", "autonomous");
    expect(await screen.findByTestId("waarschuwing-zelfstandig")).toHaveTextContent(/vragen altijd om toestemming/);
    const herstel = screen.getByTestId("inst-toestemming-herstel");
    expect(herstel).toBeEnabled();
    await userEvent.click(herstel);
    expect(api.resetUiSetting).toHaveBeenCalledWith("permission_mode");
    await waitFor(() => expect(screen.getByRole("radio", { name: /Vraag bij belangrijke dingen/ })).toBeChecked());
  });

  it("een ongeldige opgeslagen waarde valt terug op de standaard", async () => {
    (api.getUiSetting as Mock).mockImplementation(async (k: string) => (k === "permission_mode" ? "onzin" : k === "loop_threshold" ? "99" : null));
    setup("app");
    expect(await screen.findByRole("radio", { name: /Vraag bij belangrijke dingen/ })).toBeChecked();
    expect(screen.getByRole("spinbutton")).toHaveValue(3);
  });

  it("drempel: alleen geldige getallen worden bewaard", async () => {
    setup("app");
    const veld = await screen.findByRole("spinbutton");
    fireEvent.change(veld, { target: { value: "5" } });
    expect(api.setUiSetting).toHaveBeenCalledWith("loop_threshold", "5");
    (api.setUiSetting as Mock).mockClear();
    for (const slecht of ["1", "11", "", "abc"]) fireEvent.change(veld, { target: { value: slecht } });
    expect(api.setUiSetting).not.toHaveBeenCalled();
    expect(screen.getByText(/Kies een heel getal van 2 tot 10/)).toBeInTheDocument();
  });

  it("Mijn programma: tekstgrootte en standaardmap hebben een herstelknop", async () => {
    setup("app");
    open("Mijn programma");
    await userEvent.click(screen.getByRole("radio", { name: "Groter" }));
    expect(api.setUiSetting).toHaveBeenCalledWith("text_scale", "115");
    expect(screen.getByTestId("inst-tekst-herstel")).toBeEnabled();
    (api.kiesMap as Mock).mockResolvedValue("/mijn/projecten");
    await userEvent.click(screen.getByRole("button", { name: "Map kiezen" }));
    await waitFor(() => expect(screen.getByTestId("standaardmap")).toHaveTextContent("/mijn/projecten"));
    expect(api.setUiSetting).toHaveBeenCalledWith("default_project_dir", "/mijn/projecten");
  });

  it("Mijn project: beschrijving bewaren en gevarenzone met bevestiging; bestanden worden nooit gewist", async () => {
    const { onRemove } = setup("project");
    fireEvent.change(screen.getByRole("textbox", { name: "Korte beschrijving" }), { target: { value: "Een tuinsite" } });
    await userEvent.click(screen.getByRole("button", { name: "Beschrijving opslaan" }));
    expect(api.projectDescriptionSet).toHaveBeenCalledWith(1, "Een tuinsite");
    const zone = document.querySelector("[data-instelling='inst-gevaar']") as HTMLElement;
    expect(zone).toHaveTextContent(/bestanden op je computer blijven altijd staan/);
    await userEvent.click(within(zone).getByRole("button", { name: "Uit lijst verwijderen" }));
    expect(onRemove).not.toHaveBeenCalled(); // eerst bevestigen
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Uit de lijst halen" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(project));
  });

  it("Voor gevorderden is ingeklapt met een waarschuwing en haalt pas bij openen iets op", async () => {
    setup("project");
    open("Voor gevorderden");
    expect(screen.getByText(/Beginners hebben dit niet nodig/)).toBeInTheDocument();
    expect(api.cliStatus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Voor gevorderden tonen/ }));
    expect((await screen.findAllByText("/usr/bin/claude", { exact: false })).length).toBeGreaterThan(0);
    expect(screen.getByText("Dit project heeft geen studio.json.")).toBeInTheDocument();
  });

  it("Mijn AI: 'Hoeveel mag de AI nadenken?' staat standaard op Automatisch en bewaart een keuze", async () => {
    setup("project");
    open("Mijn AI");
    const auto = await screen.findByRole("radio", { name: /Automatisch/ });
    expect(auto).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Zuinig/ }));
    await waitFor(() => expect(api.setUiSetting).toHaveBeenCalledWith("model_beleid", "zuinig"));
    expect(screen.getByTestId("inst-beleid-bereik")).toHaveTextContent("Voor alle projecten");
  });

  it("Voor gevorderden: projectkaart vernieuwen, bekijken en 'Wat gaat er naar de AI?'", async () => {
    (api.kaartContext as Mock).mockResolvedValue([
      { id: "instructies", tokens: 900, te_groot: false },
      { id: "notities", tokens: 2100, te_groot: true },
      { id: "kaart", tokens: 700, te_groot: false },
    ]);
    (api.kaartVernieuw as Mock).mockResolvedValue({ aan: true, bestanden: 12, tokens: 640, terugval: 2 });
    (api.kaartTekst as Mock).mockResolvedValue("# Projectkaart\n- app.js");
    setup("project");
    open("Voor gevorderden");
    fireEvent.click(await screen.findByRole("button", { name: /Voor gevorderden|Meer opties|openen|Toon/i }));
    fireEvent.click(await screen.findByTestId("kaart-vernieuw"));
    expect(await screen.findByTestId("kaart-status")).toHaveTextContent("12 bestanden, ongeveer 640");
    expect(screen.getByTestId("kaart-status")).toHaveTextContent("2 bestanden konden niet gelezen worden");
    const lijst = await screen.findByTestId("context-lijst");
    expect(lijst).toHaveTextContent("Projectnotities (PROJECT.md): ± 2100");
    expect(lijst).toHaveTextContent("Laat de AI het inkorten");
    fireEvent.click(screen.getByTestId("kaart-bekijk"));
    expect(await screen.findByTestId("kaart-tekst")).toHaveTextContent("# Projectkaart");
  });

  it("de projectkaart uitzetten bewaart de keuze en verbergt de knoppen", async () => {
    (api.kaartContext as Mock).mockResolvedValue([]);
    setup("project");
    open("Voor gevorderden");
    fireEvent.click(await screen.findByRole("button", { name: /Voor gevorderden|Meer opties|openen|Toon/i }));
    fireEvent.click(await screen.findByRole("switch", { name: "Projectkaart gebruiken" }));
    await waitFor(() => expect(api.setUiSetting).toHaveBeenCalledWith("kaart_aan", "0"));
  });

  it("Mijn programma: licentie (gratis) en privacy zonder verborgen metingen", async () => {
    (api.licentieStatus as Mock).mockResolvedValue({ modus: "gratis" });
    setup("app");
    open("Mijn programma");
    expect(await screen.findByTestId("licentie-tekst")).toHaveTextContent("Studio is gratis");
    expect(screen.getByTestId("privacy-tekst")).toHaveTextContent("geen statistieken of verborgen metingen");
    expect(screen.getByTestId("privacy-tekst")).toHaveTextContent("Je projecten blijven op je eigen computer");
  });
  it("een kapotte licentie geeft een vriendelijke melding en Studio blijft gratis werken", async () => {
    (api.licentieStatus as Mock).mockResolvedValue({ modus: "gratis_met_melding", reden: "verlopen" });
    setup("app");
    open("Mijn programma");
    expect(await screen.findByTestId("licentie-tekst")).toHaveTextContent("de licentie is verlopen");
    expect(screen.getByTestId("licentie-tekst")).toHaveTextContent("werkt gewoon verder");
  });
});

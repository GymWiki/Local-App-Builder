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
});

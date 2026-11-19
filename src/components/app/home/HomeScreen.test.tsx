import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import HomeScreen, { sortProjects } from "./HomeScreen";
import * as api from "@/lib/api";
import type { Project } from "@/lib/api";

vi.mock("@/lib/api");

const p = (id: number, naam: string, last: string | null): Project => ({ id, naam, pad: `/p/${naam}`, template: "leeg", created_at: "2026-01-01T00:00:00Z", default_account_id: null, last_used_at: last });
const lijst = [p(1, "Kapsalon", "2026-11-01T10:00:00Z"), p(2, "Bakkerij", "2026-11-10T10:00:00Z"), p(3, "Zonder datum", null)];

function setup(projects = lijst, extra: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const props = { projects, previews: {}, onOpen: vi.fn(), onNew: vi.fn(), onAccounts: vi.fn(), onSettings: vi.fn(), onRenamed: vi.fn(), onRemove: vi.fn(), ...extra };
  render(<HomeScreen {...props} />);
  return props;
}
const namen = () => screen.getAllByTestId("project-card").map((c) => within(c).getByRole("heading").textContent);

beforeEach(() => {
  vi.resetAllMocks();
  (api.projectThumbnailGet as Mock).mockResolvedValue(null);
});

describe("HomeScreen", () => {
  it("toont een lege staat met één grote actie als er nog geen projecten zijn", () => {
    const { onNew } = setup([]);
    expect(screen.getByRole("heading", { name: "Welkom bij Studio" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Maak je eerste project" }));
    expect(onNew).toHaveBeenCalled();
    expect(screen.queryByTestId("project-card")).not.toBeInTheDocument();
  });

  it("toont een kaart per project met naam, laatst bewerkt en status; de eerste kaart is 'Nieuw project'", () => {
    const { onNew } = setup();
    expect(screen.getAllByTestId("project-card")).toHaveLength(3);
    expect(screen.getAllByTestId("project-status").map((s) => s.textContent)).toEqual(["Niet actief", "Niet actief", "Nieuw"]);
    expect(screen.getByText("Nog niet geopend")).toBeInTheDocument();
    const lijstItems = screen.getAllByRole("listitem");
    expect(within(lijstItems[0]).getByRole("button", { name: /Nieuw project/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nieuw project/ }));
    expect(onNew).toHaveBeenCalled();
  });

  it("toont de status van een draaiende preview en een fout", () => {
    setup(lijst, { previews: { 1: { status: "running" } as never, 2: { status: "error" } as never } });
    const kaart = (naam: string) => screen.getAllByTestId("project-card").find((c) => within(c).queryByRole("heading", { name: naam }))!;
    expect(within(kaart("Kapsalon")).getByTestId("project-status")).toHaveTextContent("Draait");
    expect(within(kaart("Bakkerij")).getByTestId("project-status")).toHaveTextContent("Fout");
  });

  it("sorteert op laatst gebruikt (standaard, nieuwste eerst) en op naam", () => {
    expect(sortProjects(lijst, "laatst").map((x) => x.naam)).toEqual(["Bakkerij", "Kapsalon", "Zonder datum"]);
    expect(sortProjects(lijst, "naam").map((x) => x.naam)).toEqual(["Bakkerij", "Kapsalon", "Zonder datum"]);
    setup();
    expect(namen()).toEqual(["Bakkerij", "Kapsalon", "Zonder datum"]);
  });

  it("zoekt op naam, zonder hoofdletters, en meldt als er niets is", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "Zoek in je projecten" }), { target: { value: "kaps" } });
    expect(namen()).toEqual(["Kapsalon"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    expect(screen.getByRole("status")).toHaveTextContent("Geen projecten gevonden voor ‘xyz’.");
    fireEvent.click(screen.getByRole("button", { name: "Zoekopdracht wissen" }));
    expect(screen.getAllByTestId("project-card")).toHaveLength(3);
  });

  it("opent een project met een klik op de kaart", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Kapsalon" }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("toont de miniatuur als die er is en anders een nette plaatshouder", async () => {
    (api.projectThumbnailGet as Mock).mockImplementation(async (id: number) => (id === 1 ? "data:image/jpeg;base64,AAAA" : null));
    setup();
    expect(await screen.findByAltText("Voorbeeld van Kapsalon")).toHaveAttribute("src", "data:image/jpeg;base64,AAAA");
    expect(screen.getAllByText("Nog geen voorbeeld")).toHaveLength(2);
  });

  it("het menu heeft Openen, Naam wijzigen en Uit lijst verwijderen", async () => {
    const { onOpen } = setup();
    const trigger = screen.getByRole("button", { name: "Meer acties voor Kapsalon" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Openen" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Naam wijzigen" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Uit lijst verwijderen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Openen" }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("hernoemen vraagt een geldige naam en wijzigt alleen de naam", async () => {
    (api.renameProject as Mock).mockResolvedValue({ ...lijst[0], naam: "Nieuwe naam" });
    const { onRenamed } = setup();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Meer acties voor Kapsalon" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Naam wijzigen" }));
    const veld = await screen.findByLabelText("Nieuwe naam");
    expect(veld).toHaveValue("Kapsalon");
    fireEvent.change(veld, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    expect(await screen.findByText("Geef je project een naam.")).toBeInTheDocument();
    expect(api.renameProject).not.toHaveBeenCalled();
    fireEvent.change(veld, { target: { value: "Nieuwe naam" } });
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(api.renameProject).toHaveBeenCalledWith(1, "Nieuwe naam"));
    await waitFor(() => expect(onRenamed).toHaveBeenCalled());
  });

  it("uit de lijst halen vraagt eerst bevestiging en zegt dat de bestanden blijven staan", async () => {
    const { onRemove } = setup();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Meer acties voor Kapsalon" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Uit lijst verwijderen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("De bestanden op je computer blijven staan");
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onRemove).not.toHaveBeenCalled();
  });
});

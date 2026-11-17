import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import NewProjectDialog from "./NewProjectDialog";
import * as api from "@/lib/api";

vi.mock("@/lib/api");

const project = { id: 5, naam: "Mila", pad: "/p/Mila", template: "leeg", created_at: "", default_account_id: null };

function setup() {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<NewProjectDialog onClose={onClose} onCreated={onCreated} />);
  return { onCreated, onClose };
}

describe("NewProjectDialog", () => {
  it("toont fouten in gewone taal als naam of map ontbreken en maakt dan niets aan", async () => {
    const { onCreated } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Project aanmaken" }));
    expect(await screen.findByText("Geef je project een naam.")).toBeInTheDocument();
    expect(screen.getByText("Kies eerst een map waarin het project komt.")).toBeInTheDocument();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("weigert tekens die niet in een mapnaam mogen", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Projectnaam"), { target: { value: "a/b" } });
    fireEvent.click(screen.getByRole("button", { name: "Project aanmaken" }));
    expect(await screen.findByText(/Gebruik geen tekens als/)).toBeInTheDocument();
  });

  it("maakt een leeg project aan en geeft het door", async () => {
    (api.kiesMap as Mock).mockResolvedValue("/p");
    (api.createProject as Mock).mockResolvedValue(project);
    const { onCreated } = setup();
    fireEvent.change(screen.getByLabelText("Projectnaam"), { target: { value: "  Mila  " } });
    fireEvent.click(screen.getByRole("button", { name: "Map kiezen…" }));
    expect(await screen.findByText("/p")).toBeInTheDocument();
    expect(screen.getByText(/Er wordt een map “Mila” aangemaakt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Project aanmaken" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect(api.createProject).toHaveBeenCalledWith("Mila", "/p", "leeg");
  });

  it("kan een web-app met React kiezen", async () => {
    (api.kiesMap as Mock).mockResolvedValue("/p");
    (api.createProject as Mock).mockResolvedValue({ ...project, template: "web-react-vite" });
    setup();
    fireEvent.change(screen.getByLabelText("Projectnaam"), { target: { value: "Site" } });
    fireEvent.click(screen.getByRole("button", { name: "Map kiezen…" }));
    await screen.findByText("/p");
    fireEvent.click(screen.getByRole("radio", { name: /Startklare website/ }));
    fireEvent.click(screen.getByRole("button", { name: "Project aanmaken" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith("Site", "/p", "web-react-vite"));
  });

  it("toont een foutmelding van de backend en blijft open", async () => {
    (api.kiesMap as Mock).mockResolvedValue("/p");
    (api.createProject as Mock).mockRejectedValue("De map “Site” bestaat al op die locatie.");
    const { onCreated } = setup();
    fireEvent.change(screen.getByLabelText("Projectnaam"), { target: { value: "Site" } });
    fireEvent.click(screen.getByRole("button", { name: "Map kiezen…" }));
    await screen.findByText("/p");
    fireEvent.click(screen.getByRole("button", { name: "Project aanmaken" }));
    expect(await screen.findByText(/bestaat al op die locatie/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("Annuleren sluit het venster", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    expect(onClose).toHaveBeenCalled();
  });
});

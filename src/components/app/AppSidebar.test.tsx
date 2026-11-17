import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import AppSidebar from "./AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import * as api from "@/lib/api";
import type { Project } from "@/lib/api";

vi.mock("@/lib/api");

const projects: Project[] = [
  { id: 1, naam: "Kapsalon", pad: "/a", template: "leeg", created_at: "", default_account_id: null },
  { id: 2, naam: "Boekenclub", pad: "/b", template: "leeg", created_at: "", default_account_id: null },
];

function setup(over: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  const props = { projects, selectedId: 1, accountsActive: false, onAccounts: vi.fn(), onSettings: vi.fn(), onSelect: vi.fn(), onNew: vi.fn(), onDeleted: vi.fn(), onError: vi.fn(), ...over };
  render(
    <SidebarProvider>
      <AppSidebar {...props} />
    </SidebarProvider>,
  );
  return props;
}

describe("AppSidebar", () => {
  it("toont projecten, het gekozen project is actief en een klik kiest een project", () => {
    const p = setup();
    expect(screen.getByRole("button", { name: "Kapsalon" })).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "Boekenclub" }));
    expect(p.onSelect).toHaveBeenCalledWith(2);
  });

  it("heeft ‘Nieuw project’, accounts en instellingen", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Nieuw project" }));
    fireEvent.click(screen.getByRole("button", { name: "AI-accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Instellingen" }));
    expect(p.onNew).toHaveBeenCalled();
    expect(p.onAccounts).toHaveBeenCalled();
    expect(p.onSettings).toHaveBeenCalled();
  });

  it("toont een uitnodiging als er nog geen projecten zijn", () => {
    setup({ projects: [], selectedId: null });
    expect(screen.getByText(/Nog geen projecten/)).toBeInTheDocument();
  });

  it("vraagt bevestiging voor het verwijderen uit de lijst en doet niets bij Annuleren", async () => {
    (api.deleteProject as Mock).mockResolvedValue(undefined);
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Verwijderen uit lijst: Kapsalon" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(/De bestanden op je computer blijven staan/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(api.deleteProject).not.toHaveBeenCalled();
    expect(p.onDeleted).not.toHaveBeenCalled();
  });

  it("haalt het project na bevestiging uit de lijst en meldt fouten in gewone taal", async () => {
    (api.deleteProject as Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce("kapot");
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Verwijderen uit lijst: Kapsalon" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Uit de lijst halen" }));
    await waitFor(() => expect(p.onDeleted).toHaveBeenCalledWith(1));
    fireEvent.click(screen.getByRole("button", { name: "Verwijderen uit lijst: Boekenclub" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Uit de lijst halen" }));
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith("Er ging iets mis: kapot"));
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import Workspace from "./Workspace";
import type { Project } from "../lib/api";

vi.mock("./app/chat/ChatPanel", () => ({
  default: ({ onOpenAdvanced }: { onOpenAdvanced: () => void }) => (
    <div data-testid="chat">
      <button onClick={onOpenAdvanced}>Technische weergave</button>
    </div>
  ),
}));
vi.mock("./PreviewPanel", () => ({ default: () => <div data-testid="preview" /> }));
vi.mock("./TerminalPanel", () => ({ default: () => <div data-testid="terminal" /> }));

const project: Project = { id: 1, naam: "P", pad: "/p", template: "leeg", created_at: "", default_account_id: null };

describe("Workspace", () => {
  it("toont de tabs Maken, Publiceren en Geavanceerd (geen losse Terminal/Preview-tab)", () => {
    render(<Workspace project={project} />);
    for (const naam of ["Maken", "Publiceren", "Geavanceerd"]) {
      expect(screen.getByRole("tab", { name: naam })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Terminal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("Maken is standaard actief: chat links en preview rechts, terminal verborgen", () => {
    render(<Workspace project={project} />);
    expect(screen.getByRole("tab", { name: "Maken" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chat")).toBeVisible();
    expect(screen.getByTestId("preview")).toBeInTheDocument();
    expect(screen.getByTestId("terminal").closest("[role=tabpanel]")).not.toBeVisible();
  });

  it("de terminal staat onder Geavanceerd en onder de knop 'Technische weergave' in de chat", () => {
    render(<Workspace project={project} />);
    fireEvent.click(screen.getByRole("button", { name: "Technische weergave" }));
    expect(screen.getByRole("tab", { name: "Geavanceerd" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("terminal").closest("[role=tabpanel]")).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Maken" })); // Radix-tabs schakelen bij indrukken
    expect(screen.getByTestId("terminal").closest("[role=tabpanel]")).not.toBeVisible();
  });

  it("zonder project staat er een uitnodiging in gewone taal", () => {
    const onNew = vi.fn();
    render(<Workspace project={null} onNewProject={onNew} />);
    expect(screen.getByText(/Heb je al een project/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Maken" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Maak je eerste project" }));
    expect(onNew).toHaveBeenCalled();
  });
});

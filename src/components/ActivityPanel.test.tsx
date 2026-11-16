import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import ActivityPanel from "./ActivityPanel";
import type { Project } from "../lib/api";
import * as api from "../lib/api";

vi.mock("../lib/api");

const project: Project = { id: 1, naam: "P", pad: "/p", template: "leeg", created_at: "", default_account_id: null };
const up = { state: "connected" as const, port: 1, error: null };
const points = [
  { hash: "b".repeat(40), short: "bbbbbbb", date: "2026-11-16T10:00:00+01:00", message: "Inlog toegevoegd" },
  { hash: "a".repeat(40), short: "aaaaaaa", date: "2026-11-16T09:00:00+01:00", message: "Eerste versie" },
];

beforeEach(() => {
  (api.lastChecks as Mock).mockResolvedValue([
    { id: 1, ok: false, created_at: "2026-11-16T10:00:00Z", steps: [{ name: "lint", status: "passed" }, { name: "build", status: "failed" }] },
  ]);
  (api.runtime as Mock).mockImplementation(async (_id: number, cmd: string) => (cmd === "git.list" ? points : { unchanged: false, safety: "s", hash: "n" }));
});

describe("ActivityPanel", () => {
  it("toont de tijdlijn en de laatste check-resultaten", async () => {
    render(<ActivityPanel project={project} mcp={up} tick={0} onError={vi.fn()} />);
    const tl = await screen.findByTestId("timeline");
    expect(tl).toHaveTextContent("Inlog toegevoegd");
    expect(tl).toHaveTextContent("Eerste versie");
    const checks = await screen.findByTestId("last-checks");
    expect(checks).toHaveTextContent("Mislukt");
    expect(checks).toHaveTextContent("build");
  });

  it("vraagt bevestiging en zet pas daarna terug naar de vorige versie", async () => {
    render(<ActivityPanel project={project} mcp={up} tick={0} onError={vi.fn()} />);
    await screen.findByTestId("timeline");
    fireEvent.click(screen.getByRole("button", { name: "Terug naar vorige versie" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Eerste versie");
    expect(dialog).toHaveTextContent("automatisch bewaard");
    expect(api.runtime).not.toHaveBeenCalledWith(1, "git.restore", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Ja, terugzetten" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(1, "git.restore", { hash: "a".repeat(40) }));
    expect(await screen.findByRole("status")).toHaveTextContent("back-upcheckpoint");
  });

  it("annuleren zet niets terug", async () => {
    render(<ActivityPanel project={project} mcp={up} tick={0} onError={vi.fn()} />);
    await screen.findByTestId("timeline");
    fireEvent.click(screen.getByRole("button", { name: "Terug naar vorige versie" }));
    fireEvent.click(await screen.findByRole("button", { name: "Annuleren" }));
    expect(api.runtime).not.toHaveBeenCalledWith(1, "git.restore", expect.anything());
  });

  it("knop is uitgeschakeld zonder vorige versie", async () => {
    (api.runtime as Mock).mockResolvedValue([points[0]]);
    render(<ActivityPanel project={project} mcp={up} tick={0} onError={vi.fn()} />);
    await screen.findByTestId("timeline");
    expect(screen.getByRole("button", { name: "Terug naar vorige versie" })).toBeDisabled();
  });
});

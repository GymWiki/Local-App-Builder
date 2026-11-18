import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import TerminalPanel from "./TerminalPanel";
import type { Project, CliStatus } from "../lib/api";
import * as api from "../lib/api";

vi.mock("../lib/api");
vi.mock("./TerminalView", () => ({ default: ({ sessionId }: { sessionId: string }) => <div data-testid={`term-${sessionId}`} /> }));

const project: Project = { id: 1, naam: "P", pad: "/p", template: "leeg", created_at: "", default_account_id: null, last_used_at: null };
const status = (installed: boolean): CliStatus => ({
  provider: "claude",
  installed,
  path: installed ? "/bin/claude" : null,
  install_steps: [{ label: "macOS / Linux", command: "curl -fsSL https://claude.ai/install.sh | bash" }],
  docs_url: "https://example.test",
});

function setup(mcp: api.McpInfo | null = null) {
  const change = vi.fn();
  render(<TerminalPanel project={project} accounts={[]} sessions={[]} mcp={mcp} onSessionsChange={change} onError={vi.fn()} />);
  return change;
}

describe("TerminalPanel", () => {
  it("toont installatie-uitleg met 'Opnieuw controleren' als de CLI ontbreekt en start daarna", async () => {
    (api.cliStatus as Mock).mockResolvedValueOnce(status(false)).mockResolvedValueOnce(status(true));
    (api.startAi as Mock).mockResolvedValue({ id: "pty-1", kind: "ai", provider: "claude", account_id: null, account_label: null, project_id: 1, warnings: [] });
    const change = setup();

    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
    expect(await screen.findByTestId("install-guide")).toHaveTextContent("niet geïnstalleerd");
    expect(api.startAi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Opnieuw controleren" }));
    await waitFor(() => expect(api.startAi).toHaveBeenCalledWith(1, "claude", null, {}));
    expect(change).toHaveBeenCalled();
  });

  it("toont de MCP-status en dat er geen AI actief is", () => {
    setup({ state: "connected", port: 1, error: null });
    expect(screen.getByTestId("mcp-badge")).toHaveTextContent("AI-koppeling: verbonden");
    expect(screen.getByTestId("account-badge")).toHaveTextContent("Geen AI actief");
  });

  it("Codex is uitgeschakeld", () => {
    setup();
    expect(screen.getByRole("button", { name: "Codex" })).toBeDisabled();
  });
});

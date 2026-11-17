import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import McpProblem from "./McpProblem";
import TerminalPanel from "./TerminalPanel";
import PreviewPanel from "./PreviewPanel";
import type { McpInfo, PreviewInfo, Project } from "../lib/api";
import * as api from "../lib/api";

vi.mock("../lib/api");
vi.mock("./TerminalView", () => ({ default: () => <div /> }));

const project: Project = { id: 1, naam: "P", pad: "/p", template: "leeg", created_at: "", default_account_id: null };
const crashed: McpInfo = {
  state: "unavailable",
  port: null,
  error: "De MCP-server is gestopt (exitcode 3).",
  kind: "crashed",
  log: ["[studio-mcp] start (node v22)", "Error: kapot!"],
};
const nodeMissing: McpInfo = { state: "unavailable", port: null, error: "Node.js niet gevonden. Gezocht in o.a.: C:\\Program Files\\nodejs", kind: "node_missing", log: [] };

describe("MCP-probleemmelding", () => {
  it("toont de echte reden, een hint per soort, de logregels en een knop om opnieuw te proberen", () => {
    const retry = vi.fn();
    render(<McpProblem info={crashed} onRetry={retry} />);
    expect(screen.getByTestId("mcp-problem")).toHaveTextContent("exitcode 3");
    expect(screen.getByTestId("mcp-problem")).toHaveTextContent("stopte meteen");
    expect(screen.getByTestId("mcp-log")).toHaveTextContent("Error: kapot!");
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    expect(retry).toHaveBeenCalled();
  });

  it("noemt bij ontbrekende Node.js de oplossing", () => {
    render(<McpProblem info={nodeMissing} onRetry={vi.fn()} />);
    expect(screen.getByTestId("mcp-problem")).toHaveTextContent("Node.js niet gevonden");
    expect(screen.getByTestId("mcp-problem")).toHaveTextContent("nodejs.org");
    expect(screen.getByTestId("mcp-problem")).toHaveTextContent("STUDIO_NODE_PATH");
  });

  it("terminalbalk toont de reden en probeert opnieuw", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<TerminalPanel project={project} accounts={[]} sessions={[]} mcp={nodeMissing} onSessionsChange={vi.fn()} onError={vi.fn()} onRetryMcp={retry} />);
    expect(screen.getByTestId("mcp-badge")).toHaveTextContent("niet beschikbaar");
    expect(screen.getByTestId("mcp-problem")).toHaveTextContent("Node.js niet gevonden");
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });

  it("preview-tab toont bij een Node-project dezelfde reden en een knop om opnieuw te proberen", () => {
    const preview: PreviewInfo = {
      mode: "node",
      status: "idle",
      url: null,
      hmr: false,
      problem: { kind: "runtime_unavailable", message: "De MCP-server is gestopt (exitcode 3).", log: ["Error: kapot!"] },
      plan: { entry: null, dev_script: "dev", needs_install: false },
    };
    render(<PreviewPanel project={project} mcp={crashed} preview={preview} visible onError={vi.fn()} onRetryMcp={vi.fn()} />);
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("exitcode 3");
    expect(screen.getByTestId("problem-log")).toHaveTextContent("Error: kapot!");
    expect(screen.getByRole("button", { name: "Opnieuw proberen" })).toBeInTheDocument();
  });

  it("'Controleer in Claude' toont de uitkomst, ook als Claude op goedkeuring wacht", async () => {
    (api.verifyClaudeMcp as Mock).mockResolvedValue({ verdict: "pending_approval", output: "studio: ⏸ Pending approval" });
    render(
      <TerminalPanel project={project} accounts={[]} sessions={[]} mcp={{ state: "running", port: 1, error: null }} onSessionsChange={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.queryByTestId("mcp-problem")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Controleer in Claude" }));
    const res = await screen.findByTestId("mcp-check");
    expect(res).toHaveTextContent("wacht nog op goedkeuring");
    expect(res).toHaveTextContent("Pending approval");
    expect(api.verifyClaudeMcp).toHaveBeenCalledWith(1, null);
  });
});

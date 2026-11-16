import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import PreviewPanel from "./PreviewPanel";
import type { ConfigInfo, DevStatus, Project } from "../lib/api";
import * as api from "../lib/api";

vi.mock("../lib/api");

const project: Project = { id: 1, naam: "P", pad: "/p", template: "leeg", created_at: "", default_account_id: null };
const up = { state: "running" as const, port: 1, error: null };
const cfg = (over: Partial<ConfigInfo> = {}): ConfigInfo => ({
  exists: true,
  config: { dev: "npm run dev", lint: "npm run lint", previewUrl: "http://localhost:5173/" },
  hash: "h",
  trusted: true,
  ...over,
});
const dev = (state: DevStatus["state"], error: string | null = null): DevStatus => ({ state, pid: 1, url: "http://localhost:5173/", exitCode: null, error });

function mockRuntime(c: ConfigInfo) {
  (api.runtime as Mock).mockImplementation(async (_id: number, cmd: string) => (cmd === "config.get" ? c : cmd === "dev.logs" ? ["hallo logs"] : {}));
}

describe("PreviewPanel", () => {
  it("toont uitleg als de runtime niet draait", () => {
    render(<PreviewPanel project={project} mcp={null} dev={null} visible onError={vi.fn()} />);
    expect(screen.getByText(/projectruntime draait niet/)).toBeInTheDocument();
  });

  it("biedt een voorbeeld-studio.json aan als het bestand ontbreekt", async () => {
    mockRuntime({ exists: false, config: null, hash: null, trusted: false });
    render(<PreviewPanel project={project} mcp={up} dev={null} visible onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Voorbeeld-studio.json aanmaken" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(1, "config.init"));
  });

  it("vraagt eerst goedkeuring en toont de commando's; start pas daarna", async () => {
    mockRuntime(cfg({ trusted: false }));
    (api.trustStudioConfig as Mock).mockResolvedValue(undefined);
    render(<PreviewPanel project={project} mcp={up} dev={dev("stopped")} visible onError={vi.fn()} />);
    const box = await screen.findByTestId("trust-box");
    expect(box).toHaveTextContent("npm run dev");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vertrouwen en starten" }));
    await waitFor(() => expect(api.trustStudioConfig).toHaveBeenCalledWith(1));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(1, "dev.start"));
  });

  it("toont status, iframe, herstart en stop als de preview draait", async () => {
    mockRuntime(cfg());
    render(<PreviewPanel project={project} mcp={up} dev={dev("running")} visible onError={vi.fn()} />);
    expect(screen.getByTestId("dev-badge")).toHaveTextContent("Draait");
    expect(screen.getByTitle("Preview")).toHaveAttribute("src", "http://localhost:5173/");
    fireEvent.click(screen.getByRole("button", { name: "Herstart" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(1, "dev.restart"));
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("toont foutstatus met melding en herstartknop", async () => {
    mockRuntime(cfg());
    render(<PreviewPanel project={project} mcp={up} dev={dev("error", "Dev-server stopte onverwacht (code 1).")} visible onError={vi.fn()} />);
    expect(screen.getByTestId("dev-badge")).toHaveTextContent("Fout");
    expect(screen.getByRole("alert")).toHaveTextContent("stopte onverwacht");
    expect(screen.getByRole("button", { name: "Herstart" })).toBeInTheDocument();
    expect(screen.queryByTitle("Preview")).not.toBeInTheDocument();
  });
});

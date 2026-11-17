import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import PreviewPanel from "./PreviewPanel";
import PreviewNotice from "./PreviewNotice";
import type { McpInfo, PreviewInfo, Project } from "../lib/api";
import * as api from "../lib/api";

vi.mock("../lib/api");

const project: Project = { id: 1, naam: "P", pad: "/p", template: "leeg", created_at: "", default_account_id: null };
const up: McpInfo = { state: "running", port: 1, error: null };
const down: McpInfo = { state: "unavailable", port: null, error: "Node.js niet gevonden.", kind: "node_missing", log: [] };

function info(over: Partial<PreviewInfo> = {}): PreviewInfo {
  return {
    mode: "static",
    status: "running",
    url: "http://127.0.0.1:4000/",
    hmr: false,
    problem: null,
    plan: { entry: "index.html", dev_script: null, needs_install: false },
    ...over,
  };
}
const withProblem = (kind: string, message: string, over: Partial<PreviewInfo> = {}, log: string[] = []) =>
  info({ status: "idle", url: null, problem: { kind, message, log }, ...over });

function show(p: PreviewInfo | null, mcp: McpInfo | null = null, extra: Partial<React.ComponentProps<typeof PreviewPanel>> = {}) {
  return render(<PreviewPanel project={project} mcp={mcp} preview={p} visible onError={vi.fn()} {...extra} />);
}

beforeEach(() => {
  (api.runtime as Mock).mockResolvedValue([]);
});

describe("PreviewPanel (zero-config)", () => {
  it("leeg project: meldt dat er niets previewbaars is, zonder iets over Node.js te zeggen", () => {
    show(withProblem("empty", "Er zijn nog geen previewbare bestanden.", { mode: "empty" }));
    const p = screen.getByTestId("preview-problem");
    expect(p).toHaveTextContent("Nog niets om te tonen");
    expect(p).toHaveTextContent("geen previewbare bestanden");
    expect(p).not.toHaveTextContent("Node.js");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("statische preview draait zonder runtime: iframe met de URL, badge en geen Node-melding", () => {
    show(info(), null);
    expect(screen.getByTitle("Preview")).toHaveAttribute("src", "http://127.0.0.1:4000/");
    expect(screen.getByTestId("dev-badge")).toHaveTextContent("Draait");
    expect(screen.getByText("Statische preview")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-problem")).not.toBeInTheDocument();
    expect(screen.queryByText(/projectruntime/)).not.toBeInTheDocument();
  });

  it("Node-project zonder Node.js: toont 'Node.js ontbreekt' met opnieuw proberen", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    show(withProblem("node_missing", "Node.js niet gevonden. Gezocht in o.a.: C:\\Program Files\\nodejs", { mode: "node" }), down, { onRetryMcp: retry });
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("Node.js ontbreekt");
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("nodejs.org");
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });

  it("ontbrekende dependencies: knop installeert via de backend", async () => {
    (api.previewInstall as Mock).mockResolvedValue(info());
    show(withProblem("deps_missing", "De afhankelijkheden zijn nog niet geïnstalleerd.", { mode: "node" }), up);
    fireEvent.click(screen.getByRole("button", { name: "npm install uitvoeren" }));
    await waitFor(() => expect(api.previewInstall).toHaveBeenCalledWith(1));
  });

  it("gewijzigde scripts: toont ze en vraagt goedkeuring; start niet automatisch", async () => {
    (api.previewTrustScripts as Mock).mockResolvedValue(info());
    show(withProblem("untrusted_scripts", "Scripts gewijzigd.", { mode: "node" }, ["dev=vite && curl evil", "start=", "lint=eslint"]), up);
    const box = screen.getByTestId("preview-problem");
    expect(box).toHaveTextContent("dev=vite && curl evil");
    expect(box).not.toHaveTextContent("start=");
    fireEvent.click(screen.getByRole("button", { name: "Vertrouwen en starten" }));
    await waitFor(() => expect(api.previewTrustScripts).toHaveBeenCalledWith(1));
  });

  it("gecrashte dev-server: foutstatus, melding en laatste logregels, plus herstart", async () => {
    (api.previewRestart as Mock).mockResolvedValue(info());
    show(
      info({ mode: "node", status: "error", url: null, problem: { kind: "dev_crashed", message: "Poort 5173 is al in gebruik door een ander programma.", log: ["VITE v5", "Error: EADDRINUSE"] } }),
      up,
    );
    expect(screen.getByTestId("dev-badge")).toHaveTextContent("Fout");
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("al in gebruik");
    expect(screen.getByTestId("problem-log")).toHaveTextContent("Error: EADDRINUSE");
    fireEvent.click(screen.getByRole("button", { name: "Herstart" }));
    await waitFor(() => expect(api.previewRestart).toHaveBeenCalledWith(1));
    expect(screen.queryByTitle("Preview")).not.toBeInTheDocument();
  });

  it("Flutter, kapotte studio.json en niet-ondersteunde projecten tonen hun eigen uitleg", () => {
    const { unmount } = show(withProblem("flutter", "Installeer de Flutter SDK.", { mode: "flutter" }));
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("Flutter-project");
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("Flutter SDK");
    unmount();
    show(withProblem("config_invalid", "studio.json is geen geldige JSON", { mode: "config" }));
    expect(screen.getByTestId("preview-problem")).toHaveTextContent("studio.json is ongeldig");
  });

  it("studio.json-goedkeuring toont de commando's en start daarna", async () => {
    (api.runtime as Mock).mockImplementation(async (_i: number, cmd: string) => (cmd === "config.get" ? { exists: true, config: { dev: "npm run serve" }, hash: "h", trusted: false } : []));
    (api.trustStudioConfig as Mock).mockResolvedValue(undefined);
    (api.previewStart as Mock).mockResolvedValue(info());
    show(withProblem("untrusted_config", "goedkeuring nodig", { mode: "config" }), up);
    expect(await screen.findByTestId("config-commands")).toHaveTextContent("npm run serve");
    fireEvent.click(screen.getByRole("button", { name: "Vertrouwen en starten" }));
    await waitFor(() => expect(api.trustStudioConfig).toHaveBeenCalledWith(1));
    await waitFor(() => expect(api.previewStart).toHaveBeenCalledWith(1));
  });

  it("dev-server zonder eigen HMR herlaadt het iframe bij een reload-signaal; met HMR niet", () => {
    const { rerender } = show(info({ mode: "node", hmr: false }), up, { reloadNonce: 0 });
    const first = screen.getByTitle("Preview");
    rerender(<PreviewPanel project={project} mcp={up} preview={info({ mode: "node", hmr: false })} visible reloadNonce={1} onError={vi.fn()} />);
    expect(screen.getByTitle("Preview")).not.toBe(first);

    const hmr = info({ mode: "node", hmr: true });
    rerender(<PreviewPanel project={project} mcp={up} preview={hmr} visible reloadNonce={1} onError={vi.fn()} />);
    const before = screen.getByTitle("Preview");
    rerender(<PreviewPanel project={project} mcp={up} preview={hmr} visible reloadNonce={2} onError={vi.fn()} />);
    expect(screen.getByTitle("Preview")).toBe(before);
  });

  it("instelbaar automatisch wisselen", () => {
    const toggle = vi.fn();
    show(info(), null, { autoSwitch: false, onAutoSwitch: toggle });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(toggle).toHaveBeenCalledWith(true);
  });
});

describe("PreviewNotice", () => {
  it("meldt dat de preview beschikbaar is en heeft een knop", () => {
    const view = vi.fn();
    render(<PreviewNotice projectName="Mijn site" onView={view} onClose={vi.fn()} />);
    expect(screen.getByTestId("preview-notice")).toHaveTextContent("Preview beschikbaar voor ‘Mijn site’");
    fireEvent.click(screen.getByRole("button", { name: "Bekijk preview" }));
    expect(view).toHaveBeenCalled();
  });
});

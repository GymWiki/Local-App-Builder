import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import PreviewPanel from "./PreviewPanel";
import PreviewNotice from "./PreviewNotice";
import type { McpInfo, PreviewInfo, Project } from "../lib/api";
import * as api from "../lib/api";

vi.mock("../lib/api");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

describe("PreviewPanel: schermgrootte", () => {
  it("wisselt tussen telefoon, tablet en computer; alleen de breedte van het voorbeeld verandert", () => {
    show(info());
    const frame = () => screen.getByTitle("Preview") as HTMLIFrameElement;
    expect(frame().dataset.viewport).toBe("computer");
    expect(frame().style.width).toBe("");
    expect(frame().getAttribute("src")).toBe("http://127.0.0.1:4000/");
    const groep = screen.getByRole("radiogroup", { name: "Schermgrootte van het voorbeeld" });
    expect(groep).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Telefoon" }));
    expect(frame().style.width).toBe("390px");
    expect(frame().dataset.viewport).toBe("telefoon");
    fireEvent.click(screen.getByRole("radio", { name: "Tablet" }));
    expect(frame().style.width).toBe("768px");
    fireEvent.click(screen.getByRole("radio", { name: "Computer" }));
    expect(frame().style.width).toBe("");
    expect(frame().getAttribute("src")).toBe("http://127.0.0.1:4000/"); // de pagina zelf blijft dezelfde
  });

  it("zonder draaiende preview staat er geen schermkeuze", () => {
    show(info({ status: "idle", url: null }));
    expect(screen.queryByRole("radiogroup", { name: "Schermgrootte van het voorbeeld" })).not.toBeInTheDocument();
  });
});

describe("PreviewPanel: klik-en-beschrijf", () => {
  const frame = () => screen.getByTitle("Preview") as HTMLIFrameElement;
  const melding = (data: unknown, source: Window | null = frame().contentWindow) => act(() => void window.dispatchEvent(new MessageEvent("message", { data, source })));

  beforeEach(() => {
    (api.runtime as Mock).mockImplementation(async (_id: number, cmd: string) => (cmd === "picker.url" ? { url: "http://127.0.0.1:5555/" } : cmd === "picker.shot" ? { path: ".studio/picks/pick-1.jpg", found: true } : []));
    (api.chatSend as Mock).mockResolvedValue(undefined);
  });

  it("de knop staat er alleen met een draaiende runtime; aanzetten laadt de preview via de tussenserver en zet de picker aan", async () => {
    const { unmount } = show(info(), null);
    expect(screen.queryByRole("button", { name: "Kies een onderdeel" })).not.toBeInTheDocument();
    unmount();
    show(info(), up);
    const post = vi.spyOn(frame().contentWindow!, "postMessage");
    fireEvent.click(screen.getByRole("button", { name: "Kies een onderdeel" }));
    await waitFor(() => expect(frame().getAttribute("src")).toBe("http://127.0.0.1:5555/"));
    expect(api.runtime).toHaveBeenCalledWith(1, "picker.url");
    expect(screen.getByRole("button", { name: "Kies een onderdeel" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Wijs een onderdeel aan/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith({ type: "studio-picker", on: true }, "*");
  });

  it("een klik in het voorbeeld toont ‘Wat moet hier anders?’ en stuurt wens + selector + schermafbeelding naar de chat", async () => {
    show(info(), up);
    fireEvent.click(screen.getByRole("button", { name: "Kies een onderdeel" }));
    await waitFor(() => expect(frame().getAttribute("src")).toBe("http://127.0.0.1:5555/"));
    melding({ type: "studio-pick", selector: "main > button.groot", tag: "button", text: "Afspraak maken", path: "/" });
    const veld = await screen.findByLabelText("Beschrijf je wens");
    expect(screen.getByText(/Gekozen onderdeel: button — ‘Afspraak maken’/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Naar de AI sturen" })).toBeDisabled();
    fireEvent.change(veld, { target: { value: "maak deze knop groter en groen" } });
    fireEvent.click(screen.getByRole("button", { name: "Naar de AI sturen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(1, expect.stringContaining("maak deze knop groter en groen"), [".studio/picks/pick-1.jpg"]));
    const prompt = (api.chatSend as Mock).mock.calls[0][1] as string;
    expect(prompt).toContain("main > button.groot");
    expect(prompt).toContain("Afspraak maken");
    expect(prompt).toContain("schermafbeelding van het onderdeel");
    expect(api.runtime).toHaveBeenCalledWith(1, "picker.shot", { selector: "main > button.groot", path: "/" });
  });

  it("zonder schermafbeelding (geen browser) wordt de wens toch verstuurd", async () => {
    (api.runtime as Mock).mockImplementation(async (_id: number, cmd: string) => {
      if (cmd === "picker.shot") throw new Error("Geen browser gevonden");
      return cmd === "picker.url" ? { url: "http://127.0.0.1:5555/" } : [];
    });
    show(info(), up);
    fireEvent.click(screen.getByRole("button", { name: "Kies een onderdeel" }));
    await waitFor(() => expect(frame().getAttribute("src")).toBe("http://127.0.0.1:5555/"));
    melding({ type: "studio-pick", selector: "h1", tag: "h1", text: "", path: "/over" });
    fireEvent.change(await screen.findByLabelText("Beschrijf je wens"), { target: { value: "andere kop" } });
    fireEvent.click(screen.getByRole("button", { name: "Naar de AI sturen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledTimes(1));
    expect((api.chatSend as Mock).mock.calls[0]).toHaveLength(2); // geen bijlagen
    expect((api.chatSend as Mock).mock.calls[0][1]).not.toContain("schermafbeelding van het onderdeel");
  });

  it("berichten van andere vensters of met een onbekend type worden genegeerd; Annuleren verstuurt niets", async () => {
    show(info(), up);
    fireEvent.click(screen.getByRole("button", { name: "Kies een onderdeel" }));
    await waitFor(() => expect(frame().getAttribute("src")).toBe("http://127.0.0.1:5555/"));
    melding({ type: "studio-pick", selector: "h1", tag: "h1", text: "", path: "/" }, window); // verkeerde afzender
    melding({ type: "iets-anders" });
    expect(screen.queryByLabelText("Beschrijf je wens")).not.toBeInTheDocument();
    melding({ type: "studio-pick", selector: "h1", tag: "h1", text: "", path: "/" });
    await screen.findByLabelText("Beschrijf je wens");
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByLabelText("Beschrijf je wens")).not.toBeInTheDocument());
    expect(api.chatSend).not.toHaveBeenCalled();
    melding({ type: "studio-pick-cancel" });
  });
});

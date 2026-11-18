import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import EigenschappenPanel, { tokenNaam } from "./EigenschappenPanel";
import type { PickedElement, PreviewControl } from "../pick";

vi.mock("@/lib/api");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const knop: PickedElement = {
  selector: "#k",
  tag: "button",
  text: "Vraag een offerte aan",
  path: "/",
  size: { width: 194, height: 42 },
  styles: { color: "rgb(255, 255, 255)", background: "rgb(21, 128, 61)", fontSize: "16px", borderRadius: "8px", padding: "12px 20px", gap: "normal" },
  tokens: [
    { prop: "background", token: "--primary" },
    { prop: "border-radius", token: "--radius-lg" },
  ],
  kit: { name: "button", self: true },
  breadcrumb: [
    { label: "body", selector: "body" },
    { label: "main", selector: "main" },
    { label: "button#k", selector: "#k" },
  ],
  children: [
    { label: "span", selector: "#k > span:nth-of-type(1)" },
    { label: "span", selector: "#k > span:nth-of-type(2)" },
  ],
  childCount: 2,
  hidden: false,
};

function setup(over: Partial<React.ComponentProps<typeof EigenschappenPanel>> = {}) {
  const control = createRef<PreviewControl | null>() as { current: PreviewControl | null };
  control.current = { startPick: vi.fn().mockResolvedValue(undefined), select: vi.fn(), clear: vi.fn(), askPage: vi.fn(), navigate: vi.fn() };
  const props = { projectId: 4, selection: null, page: null, control, previewRunning: true, onClear: vi.fn(), onError: vi.fn(), ...over };
  render(<EigenschappenPanel {...props} />);
  return props;
}

beforeEach(() => vi.resetAllMocks());

describe("Eigenschappen", () => {
  it("zonder keuze: korte uitleg, een knop om een onderdeel te kiezen en de gegevens van de pagina", () => {
    const { control } = setup({ page: { title: "Tuin", path: "/", lang: "nl", width: 1200, height: 700, background: "rgb(240, 253, 244)", color: "rgb(20, 83, 45)", fontFamily: "Georgia" } });
    expect(screen.getByText(/Kies in het voorbeeld een onderdeel/)).toBeInTheDocument();
    expect(screen.getByTestId("pagina-info")).toHaveTextContent("Tuin");
    expect(screen.getByTestId("pagina-info")).toHaveTextContent("1200 × 700 pixels");
    fireEvent.click(screen.getByRole("button", { name: "Kies een onderdeel" }));
    expect(control.current!.startPick).toHaveBeenCalled();
  });

  it("zonder draaiend voorbeeld wordt uitgelegd wat er eerst moet gebeuren", () => {
    setup({ previewRunning: false });
    expect(screen.queryByRole("button", { name: "Kies een onderdeel" })).not.toBeInTheDocument();
    expect(screen.getByText(/Het voorbeeld draait niet/)).toBeInTheDocument();
  });

  it("met keuze: soort, tekst, afmetingen, kitonderdeel, thematokens en losse waarden in gewoon Nederlands", () => {
    setup({ selection: knop });
    const s = screen.getByTestId("eigenschappen-selectie");
    expect(s).toHaveTextContent("Knop");
    expect(s).toHaveTextContent("Vraag een offerte aan");
    expect(s).toHaveTextContent("194 × 42 pixels");
    expect(s).toHaveTextContent("Ja, dit is het onderdeel ‘button’ uit het uiterlijk.");
    expect(screen.getByTestId("tokens")).toHaveTextContent("Achtergrond");
    expect(screen.getByTestId("tokens")).toHaveTextContent("primary (--primary)");
    expect(screen.getByTestId("tokens")).toHaveTextContent("Afronding van de hoeken");
    expect(screen.getByTestId("tokens")).toHaveTextContent("lg (--radius-lg)");
    expect(screen.getByTestId("tokens")).toHaveTextContent("Tekstkleur");
    expect(screen.getByTestId("tokens")).toHaveTextContent("los ingesteld");
    expect(screen.getByTestId("tokens")).not.toHaveTextContent("Achtergrondkleur"); // al gedekt door het token
  });

  it("een eigen onderdeel zonder tokens zegt dat eerlijk", () => {
    setup({ selection: { ...knop, tokens: [], kit: null } });
    expect(screen.getByText(/Geen thematoken gevonden/)).toBeInTheDocument();
    expect(screen.getByText("Nee, dit is een eigen onderdeel.")).toBeInTheDocument();
  });

  it("de plek in de pagina is een kruimelpad; een klik op een stap kiest dat onderdeel", () => {
    const { control } = setup({ selection: knop });
    const nav = screen.getByTestId("breadcrumb");
    expect(nav).toHaveTextContent("body›main›button#k");
    fireEvent.click(screen.getByRole("button", { name: "main" }));
    expect(control.current!.select).toHaveBeenCalledWith("main");
  });

  it("'onderdeel erboven' en 'onderdeel eronder' kiezen ouder en kind", async () => {
    const { control } = setup({ selection: knop });
    fireEvent.click(screen.getByRole("button", { name: "Kies het onderdeel erboven" }));
    expect(control.current!.select).toHaveBeenCalledWith("main");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Kies een onderdeel eronder" }), { button: 0, ctrlKey: false });
    fireEvent.click((await screen.findAllByRole("menuitem"))[1]);
    expect(control.current!.select).toHaveBeenCalledWith("#k > span:nth-of-type(2)");
  });

  it("zonder ouder of kind staan de knoppen uit", () => {
    setup({ selection: { ...knop, breadcrumb: [{ label: "body", selector: "body" }], children: [], childCount: 0 } });
    expect(screen.getByRole("button", { name: "Kies het onderdeel erboven" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kies een onderdeel eronder" })).toBeDisabled();
  });

  it("de wens gaat met een schermafbeelding van het onderdeel naar de chat", async () => {
    (api.runtime as Mock).mockResolvedValue({ path: ".studio/picks/pick-1.jpg" });
    (api.chatSend as Mock).mockResolvedValue(undefined);
    setup({ selection: knop });
    const verstuur = screen.getByRole("button", { name: "Naar de AI sturen" });
    expect(verstuur).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Beschrijf wat je anders wilt"), { target: { value: "maak dit groter" } });
    fireEvent.click(verstuur);
    await waitFor(() => expect(api.chatSend).toHaveBeenCalled());
    const [id, prompt, bijlagen] = (api.chatSend as Mock).mock.calls[0];
    expect(id).toBe(4);
    expect(prompt).toContain("maak dit groter");
    expect(prompt).toContain("#k");
    expect(bijlagen).toEqual([".studio/picks/pick-1.jpg"]);
    expect(api.runtime).toHaveBeenCalledWith(4, "picker.shot", { selector: "#k", path: "/" });
  });

  it("zonder schermafbeelding (geen browser) gaat de wens toch door", async () => {
    (api.runtime as Mock).mockRejectedValue(new Error("Geen browser"));
    (api.chatSend as Mock).mockResolvedValue(undefined);
    setup({ selection: knop });
    fireEvent.change(screen.getByLabelText("Beschrijf wat je anders wilt"), { target: { value: "maak dit groter" } });
    fireEvent.click(screen.getByRole("button", { name: "Naar de AI sturen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledTimes(1));
    expect((api.chatSend as Mock).mock.calls[0]).toHaveLength(2);
  });

  it("de keuze is te wissen", () => {
    const { onClear } = setup({ selection: knop });
    fireEvent.click(screen.getByRole("button", { name: "Keuze wissen" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("tokennamen worden korter gemaakt", () => {
    expect(tokenNaam("--color-primary")).toBe("primary");
    expect(tokenNaam("--radius-lg")).toBe("lg");
    expect(tokenNaam("--brand")).toBe("brand");
  });
});

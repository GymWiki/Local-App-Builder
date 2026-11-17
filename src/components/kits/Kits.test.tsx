import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import KitPicker from "./KitPicker";
import AppearancePanel from "./AppearancePanel";
import type { KitApplyOutcome, KitCard, KitCurrent } from "../../lib/api";
import * as api from "../../lib/api";

vi.mock("../../lib/api");

const card = (o: Partial<KitCard> = {}): KitCard => ({
  id: "fragments-ui",
  naam: "Fragments UI",
  beschrijving: "Een complete bibliotheek.",
  label: "Snel en compleet",
  licentie: "MIT",
  stacks: ["react-vite"],
  compatible: true,
  attributieVerplicht: false,
  installatiescripts: false,
  pakketten: ["@usefragments/ui@4.5.0"],
  preview: "data:image/png;base64,AAAA",
  kleuren: { primair: "#3d5ae8", achtergrond: "#ffffff", tekst: "#111111" },
  ...o,
});
const ok = (o: Partial<KitApplyOutcome> = {}): KitApplyOutcome => ({ ok: true, code: "ok", rolledBack: false, scriptsSkipped: [], switched: false, ...o });

function setupList(kits: KitCard[]) {
  (api.kitList as Mock).mockResolvedValue({ stack: "react-vite", kits, geweigerd: [] });
  (api.chatSend as Mock).mockResolvedValue(undefined);
}

describe("KitPicker", () => {
  it("toont kaarten met naam, omschrijving, licentie, geschikt voor en label; kits die niet passen zijn niet kiesbaar", async () => {
    setupList([card(), card({ id: "flutter-material", naam: "Material", stacks: ["flutter"], compatible: false, licentie: "BSD-3-Clause" })]);
    render(<KitPicker projectId={1} onApplied={vi.fn()} onError={vi.fn()} />);
    const k = await screen.findByTestId("kit-fragments-ui");
    expect(within(k).getByText("Snel en compleet")).toBeInTheDocument();
    expect(within(k).getByText("Licentie: MIT")).toBeInTheDocument();
    expect(within(k).getByText("Geschikt voor: React-websites")).toBeInTheDocument();
    const m = screen.getByTestId("kit-flutter-material");
    expect(within(m).getByText("Past niet bij dit project")).toBeInTheDocument();
    expect(within(m).getByRole("button", { name: /Kies dit uiterlijk/ })).toBeDisabled();
  });

  it("toont een live voorbeeld bij aanwijzen", async () => {
    setupList([card(), card({ id: "b", naam: "Tweede", preview: "data:image/png;base64,BBBB" })]);
    render(<KitPicker projectId={1} onApplied={vi.fn()} onError={vi.fn()} />);
    await screen.findByTestId("kit-b");
    expect(screen.getByAltText("Voorbeeld van Fragments UI")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId("kit-b"));
    expect(screen.getByAltText("Voorbeeld van Tweede")).toBeInTheDocument();
  });

  it("vraagt bevestiging met de pakketten en past dan toe; installatiescripts worden pas na goedkeuring uitgevoerd", async () => {
    setupList([card({ installatiescripts: true })]);
    (api.kitApply as Mock).mockResolvedValue(ok({ scriptsSkipped: ["esbuild"] }));
    (api.kitScripts as Mock).mockResolvedValue({ ok: true });
    const onApplied = vi.fn();
    render(<KitPicker projectId={7} onApplied={onApplied} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kies dit uiterlijk: Fragments UI/ }));
    const dlg = screen.getByRole("dialog", { name: "Fragments UI" });
    expect(within(dlg).getByText("@usefragments/ui@4.5.0")).toBeInTheDocument();
    expect(within(dlg).getByText(/installatiescripts/)).toBeInTheDocument();
    expect(within(dlg).getByText(/zet ik alles terug/)).toBeInTheDocument();
    expect(api.kitApply).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Toepassen" }));
    expect(await screen.findByText("Klaar! Je app heeft nu het uiterlijk ‘Fragments UI’.")).toBeInTheDocument();
    expect(api.kitApply).toHaveBeenCalledWith(7, "fragments-ui");
    expect(onApplied).toHaveBeenCalled();
    expect(api.kitScripts).not.toHaveBeenCalled();
    const ask = screen.getByRole("dialog", { name: "Installatiescripts goedkeuren?" });
    expect(ask).toHaveTextContent("esbuild");
    fireEvent.click(within(ask).getByRole("button", { name: "Ja, uitvoeren" }));
    await waitFor(() => expect(api.kitScripts).toHaveBeenCalledWith(7, ["esbuild"]));
  });

  it("slaat installatiescripts over als de gebruiker nee zegt", async () => {
    setupList([card()]);
    (api.kitApply as Mock).mockResolvedValue(ok({ scriptsSkipped: ["esbuild"] }));
    render(<KitPicker projectId={1} onApplied={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kies dit uiterlijk/ }));
    fireEvent.click(screen.getByRole("button", { name: "Toepassen" }));
    const ask = await screen.findByRole("dialog", { name: "Installatiescripts goedkeuren?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Nee, overslaan" }));
    expect(screen.queryByRole("dialog", { name: "Installatiescripts goedkeuren?" })).not.toBeInTheDocument();
    expect(api.kitScripts).not.toHaveBeenCalled();
  });

  it("legt uit dat er is teruggedraaid als installeren of de controles mislukken, met details op aanvraag", async () => {
    setupList([card()]);
    (api.kitApply as Mock).mockResolvedValueOnce(ok({ ok: false, code: "install_failed", rolledBack: true, detail: "npm ERR! 404" }));
    const onApplied = vi.fn();
    render(<KitPicker projectId={1} onApplied={onApplied} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kies dit uiterlijk/ }));
    fireEvent.click(screen.getByRole("button", { name: "Toepassen" }));
    expect(await screen.findByText("Het installeren lukte niet. Je project is teruggezet zoals het was.")).toBeInTheDocument();
    expect(screen.getByText("npm ERR! 404")).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kies een uiterlijk" }));
    expect(await screen.findByTestId("kit-fragments-ui")).toBeInTheDocument();
  });

  it("meldt de reden als een kit geweigerd wordt, zonder technische taal", async () => {
    setupList([card()]);
    (api.kitApply as Mock).mockResolvedValue(ok({ ok: false, code: "refused", detail: "Deze kit past niet bij dit project." }));
    render(<KitPicker projectId={1} onApplied={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kies dit uiterlijk/ }));
    fireEvent.click(screen.getByRole("button", { name: "Toepassen" }));
    expect(await screen.findByText("Dit uiterlijk kan ik hier niet gebruiken.")).toBeInTheDocument();
    expect(screen.getByText("Deze kit past niet bij dit project.")).toBeInTheDocument();
  });

  it("wisselen: toont voor en na, laat de AI migreren en kan terugdraaien", async () => {
    setupList([card()]);
    (api.kitApply as Mock).mockResolvedValue(ok({ switched: true, before: "abc1234", shotBefore: "data:image/jpeg;base64,V", shotAfter: "data:image/jpeg;base64,N" }));
    (api.runtime as Mock).mockResolvedValue({});
    render(<KitPicker projectId={3} onApplied={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kies dit uiterlijk/ }));
    fireEvent.click(screen.getByRole("button", { name: "Toepassen" }));
    expect(await screen.findByAltText("Voor")).toBeInTheDocument();
    expect(screen.getByAltText("Na")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Laat de AI de onderdelen aanpassen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(3, expect.stringContaining("‘Fragments UI’")));
    expect((api.chatSend as Mock).mock.calls[0][1]).toContain("docs/ui-kit.md");
    fireEvent.click(screen.getByRole("button", { name: "Terugdraaien naar het vorige uiterlijk" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(3, "git.restore", { hash: "abc1234" }));
    expect(await screen.findByText("Teruggezet naar het vorige uiterlijk.")).toBeInTheDocument();
  });

  it("‘Eigen stijl’ waarschuwt eerlijk en stuurt de opdracht naar de AI; ‘op basis van een kit’ past eerst de kit toe", async () => {
    setupList([card()]);
    (api.kitApply as Mock).mockResolvedValue(ok());
    render(<KitPicker projectId={5} onApplied={vi.fn()} onError={vi.fn()} />);
    await screen.findByTestId("kit-fragments-ui");
    expect(screen.getByText(/meer tijd en meer tokens/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Eigen stijl kiezen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(5, expect.stringContaining("eigen stijl")));
    (api.chatSend as Mock).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Kit als basis kiezen", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: /Kit als basis kiezen: Fragments UI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Toepassen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(5, expect.stringContaining("alleen de tokens")));
    expect(api.kitApply).toHaveBeenCalledWith(5, "fragments-ui");
  });

  it("waarschuwt vooraf bij verplichte vermelding", async () => {
    setupList([card({ attributieVerplicht: true })]);
    render(<KitPicker projectId={1} onApplied={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kies dit uiterlijk/ }));
    expect(screen.getByText(/vermelding verplicht/)).toBeInTheDocument();
  });
});

const current = (o: Partial<KitCurrent> = {}): KitCurrent => ({
  kit: { kit: "fragments-ui", naam: "Fragments UI", versie: "4.5.0", licentie: "MIT", stack: "react-vite" },
  tokens: { kleuren: { licht: { primair: "#3d5ae8" }, donker: { primair: "#3d5ae8" } }, rondingen: {}, spacing: { schaal: 1, eenheid: "4px" }, typografie: { lettertype: "system-ui, -apple-system, 'Segoe UI', sans-serif" } },
  attributie: { required: false, ok: true },
  ...o,
});

describe("AppearancePanel", () => {
  it("zonder uiterlijk komt de kiezer, met uiterlijk de huidige kit met licentie", async () => {
    setupList([card()]);
    (api.kitCurrent as Mock).mockResolvedValueOnce(current({ kit: null, tokens: null }));
    const { unmount } = render(<AppearancePanel projectId={1} firstRun onError={vi.fn()} />);
    expect(await screen.findByText("Kies eerst hoe je app eruit moet zien")).toBeInTheDocument();
    unmount();
    (api.kitCurrent as Mock).mockResolvedValueOnce(current());
    render(<AppearancePanel projectId={1} onError={vi.fn()} />);
    expect(await screen.findByTestId("kit-current")).toHaveTextContent("Fragments UI · Versie 4.5.0 · Licentie: MIT");
  });

  it("past afronding, ruimte, lettertype en kleur aan zonder AI", async () => {
    (api.kitCurrent as Mock).mockResolvedValue(current());
    (api.kitTailor as Mock).mockImplementation(async () => current().tokens);
    render(<AppearancePanel projectId={2} onError={vi.fn()} />);
    await screen.findByTestId("kit-current");
    fireEvent.click(screen.getByRole("radio", { name: "Rond" }));
    await waitFor(() => expect(api.kitTailor).toHaveBeenCalledWith(2, { afronding: "rond" }));
    fireEvent.click(screen.getByRole("radio", { name: "Ruim" }));
    await waitFor(() => expect(api.kitTailor).toHaveBeenCalledWith(2, { ruimte: "ruim" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "serif" } });
    await waitFor(() => expect(api.kitTailor).toHaveBeenCalledWith(2, { lettertype: "Georgia, 'Times New Roman', serif" }));
    fireEvent.change(screen.getByLabelText("Hoofdkleur"), { target: { value: "#ff0066" } });
    await waitFor(() => expect(api.kitTailor).toHaveBeenCalledWith(2, { hoofdkleur: "#ff0066" }));
    fireEvent.click(screen.getByRole("button", { name: "Terug naar de standaard van de kit" }));
    await waitFor(() => expect(api.kitTailor).toHaveBeenCalledWith(2, { reset: true }));
  });

  it("bewaart de aanpassing als versie", async () => {
    (api.kitCurrent as Mock).mockResolvedValue(current());
    (api.runtime as Mock).mockResolvedValue({ created: true });
    render(<AppearancePanel projectId={2} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Bewaar als versie" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(2, "git.checkpoint", { message: "Uiterlijk aangepast" }));
    expect(await screen.findByText("Bewaard als versie.")).toBeInTheDocument();
  });

  it("waarschuwt als de verplichte vermelding is weggehaald", async () => {
    (api.kitCurrent as Mock).mockResolvedValue(current({ attributie: { required: true, ok: false } }));
    render(<AppearancePanel projectId={2} onError={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("vermelding in NOTICE.md ontbreekt");
  });

  it("‘Ander uiterlijk kiezen’ opent de kiezer en ‘Annuleren’ brengt je terug", async () => {
    setupList([card()]);
    (api.kitCurrent as Mock).mockResolvedValue(current());
    render(<AppearancePanel projectId={2} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ander uiterlijk kiezen" }));
    expect(await screen.findByTestId("kit-fragments-ui")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    expect(await screen.findByTestId("kit-current")).toBeInTheDocument();
  });
});

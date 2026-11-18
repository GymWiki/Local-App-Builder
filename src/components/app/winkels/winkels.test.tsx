import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { WinkelAppData, WinkelOverzicht, WinkelVeldStand } from "@/lib/api";
import Gegevens from "./Gegevens";
import Invulhulp from "./Invulhulp";
import KlaarCheck from "./KlaarCheck";
import Teksten, { tel } from "./Teksten";
import Veilig from "./Veilig";

vi.mock("@/lib/api");

const data = (over: Partial<WinkelAppData> = {}): WinkelAppData => ({ app_naam: "Winkel", android_id: "", ios_id: "", categorie_play: "", categorie_apple: "", contact_email: "", website: "", privacy_url: "", support_url: "", leeftijd_ingevuld: false, heeft_login: false, demo_account_gezet: false, bevestigd: {}, talen: ["nl"], ...over });
const overzicht = (over: Partial<WinkelOverzicht> = {}): WinkelOverzicht => ({ data: data(), winkels: [], invulhulp: { signalen: { permissies: [], pakketten: [], onderwerpen: [] }, kaarten: [] }, veilig: [], versie: { naam: "1.0.0", build: 1 }, nodig: {}, spec: { versie: 1, datum: "2026-11-18", talen: ["nl", "en"], app_id: {} }, ...over });
const veld = (over: Partial<WinkelVeldStand> = {}): WinkelVeldStand => ({ veld: "subtitel", officieel: "Subtitle", goedgekeurd: null, concept: null, telling: null, min: 1, max: 30, eenheid: "tekens", geverifieerd: true, bron: "https://x", ...over });

beforeEach(() => vi.resetAllMocks());

describe("telling", () => {
  it("telt emoji en letters met accent als één teken en bytes als bytes", () => {
    expect(tel("tekens", "é")).toBe(1);
    expect(tel("tekens", "👍🏽")).toBe(1);
    expect(tel("tekens", "👨‍👩‍👧")).toBe(1);
    expect(tel("bytes", "é")).toBe(2);
    expect(tel("bytes", "👍")).toBe(4);
  });
});

describe("Gegevens", () => {
  it("toont een duidelijke fout bij een ongeldige unieke app-naam en bewaart niets", async () => {
    (api.winkelsBewaar as Mock).mockResolvedValue({ fout: "app_id", veld: "android_id", code: "begint_niet_met_letter" });
    render(<Gegevens projectId={1} overzicht={overzicht()} onBewaard={() => undefined} />);
    fireEvent.change(screen.getByTestId("wg-android"), { target: { value: "nl.1winkel" } });
    fireEvent.click(screen.getByTestId("wg-bewaar"));
    expect(await screen.findByText("Elk deel moet met een letter beginnen.")).toBeInTheDocument();
  });

  it("doet een voorstel voor de app-naam en kan dat overnemen", async () => {
    (api.winkelsAppIdVoorstel as Mock).mockResolvedValue({ voorstel: "nl.mijnwinkel.winkel", android: { geldig: true, code: "", let_op: null }, ios: { geldig: true, code: "", let_op: null } });
    render(<Gegevens projectId={1} overzicht={overzicht()} onBewaard={() => undefined} />);
    fireEvent.change(screen.getByTestId("wg-domein"), { target: { value: "mijnwinkel.nl" } });
    fireEvent.click(screen.getByTestId("wg-voorstel"));
    expect(await screen.findByTestId("wg-voorstel-tekst")).toHaveTextContent("nl.mijnwinkel.winkel");
    fireEvent.click(screen.getByRole("button", { name: "Gebruik dit" }));
    expect((screen.getByTestId("wg-android") as HTMLInputElement).value).toBe("nl.mijnwinkel.winkel");
    expect((screen.getByTestId("wg-ios") as HTMLInputElement).value).toBe("nl.mijnwinkel.winkel");
  });

  it("toont het versienummer en verhoogt het buildnummer", async () => {
    (api.winkelsVersieOphogen as Mock).mockResolvedValue({ oud: "1.0.0+1", nieuw: "1.0.0+2" });
    const klaar = vi.fn();
    render(<Gegevens projectId={1} overzicht={overzicht()} onBewaard={klaar} />);
    expect(screen.getByTestId("winkels-versie-nu")).toHaveTextContent("1.0.0+1");
    fireEvent.click(screen.getByTestId("versie-build"));
    await waitFor(() => expect(api.winkelsVersieOphogen).toHaveBeenCalledWith(1, "build"));
    await waitFor(() => expect(klaar).toHaveBeenCalled());
  });

  it("zonder Flutter-versie legt het scherm uit dat Studio die niet kan ophogen", () => {
    render(<Gegevens projectId={1} overzicht={overzicht({ versie: null })} onBewaard={() => undefined} />);
    expect(screen.getByTestId("winkels-versie")).toHaveTextContent("alleen lezen en ophogen in een Flutter-app");
  });
});

describe("KlaarCheck", () => {
  const stand = { winkel: "play" as const, klaar: 1, totaal: 3, punten: [{ id: "app_id", status: "klaar" as const, detail: null }, { id: "teksten", status: "let_op" as const, detail: { klaar: 4, totaal: 8, mist: [] } }, { id: "data_safety", status: "handmatig" as const, detail: null }] };

  it("toont bolletjes, tellingen en laat je zelf-doen-punten afvinken", () => {
    const wijzig = vi.fn();
    render(<KlaarCheck stand={stand} data={data()} onWijzig={wijzig} />);
    expect(screen.getByTestId("klaar-telling-play")).toHaveTextContent("1 van 3 klaar");
    expect(screen.getByText("(4 van 8)")).toBeInTheDocument();
    expect(document.querySelector("[data-punt=data_safety]")).toHaveAttribute("data-status", "handmatig");
    fireEvent.click(screen.getByRole("checkbox", { name: "Ik heb dit gedaan" }));
    expect(wijzig).toHaveBeenCalledWith(expect.objectContaining({ bevestigd: { data_safety: true } }));
  });
});

describe("Invulhulp en Veilig", () => {
  it("de antwoordkaarten tonen een voorstel met reden en de verantwoordelijkheid blijft bij de ontwikkelaar", () => {
    render(<Invulhulp kaarten={[{ id: "advertenties", winkels: ["play"], antwoord: "ja", redenen: ["pakket:advertenties"] }, { id: "leeftijd", winkels: ["play", "appstore"], antwoord: "controleer", redenen: ["jij_beslist"] }]} />);
    expect(screen.getByTestId("invul-verantwoordelijk")).toHaveTextContent("geen juridisch advies");
    const k = document.querySelector("[data-kaart=advertenties]")!;
    expect(k).toHaveTextContent("Ja");
    expect(k).toHaveTextContent("Je app gebruikt iets voor: advertenties.");
    expect(document.querySelector("[data-kaart=leeftijd]")).toHaveTextContent("Dit kan alleen jij beslissen.");
  });

  it("de controle toont fouten en waarschuwingen en 'Laat de AI dit herstellen' stuurt de lijst", () => {
    const vraag = vi.fn();
    render(<Veilig bevindingen={[{ code: "privacy_ontbreekt", ernst: "fout", detail: null }, { code: "gevoelig_recht", ernst: "let_op", detail: "READ_SMS" }]} onVraagAi={vraag} />);
    expect(screen.getByText("Je privacyverklaring ontbreekt")).toBeInTheDocument();
    expect(document.querySelector("[data-code=gevoelig_recht]")).toHaveAttribute("data-ernst", "let_op");
    fireEvent.click(screen.getByTestId("veilig-herstel"));
    expect(vraag.mock.calls[0][0]).toContain("READ_SMS");
    expect(screen.getByText(/alleen op uiterlijk gecontroleerd/)).toBeInTheDocument();
  });

  it("zonder bevindingen staat er een rustige melding en geen herstelknop", () => {
    render(<Veilig bevindingen={[]} onVraagAi={() => undefined} />);
    expect(screen.getByTestId("veilig-niets")).toBeInTheDocument();
    expect(screen.queryByTestId("veilig-herstel")).not.toBeInTheDocument();
  });
});

describe("Teksten", () => {
  const toon = (onVraagAi = vi.fn()) => render(<Teksten projectId={1} talen={["nl", "en"]} onVraagAi={onVraagAi} />);

  it("toont de teller met ✓ of ! en blokkeert goedkeuren boven de limiet", async () => {
    (api.winkelsTeksten as Mock).mockResolvedValue([veld()]);
    toon();
    const t = await screen.findByTestId("tekst-subtitel");
    fireEvent.change(t, { target: { value: "Korte ondertitel" } });
    expect(screen.getByTestId("teller-subtitel")).toHaveAttribute("data-goed", "ja");
    expect(screen.getByTestId("teller-subtitel")).toHaveTextContent("16 van 30 tekens");
    expect(screen.getByTestId("goedkeuren-subtitel")).toBeEnabled();
    fireEvent.change(t, { target: { value: "x".repeat(31) } });
    expect(screen.getByTestId("teller-subtitel")).toHaveAttribute("data-goed", "nee");
    expect(screen.getByTestId("goedkeuren-subtitel")).toBeDisabled();
    // Emoji tellen als één teken.
    fireEvent.change(t, { target: { value: "👍🏽".repeat(30) } });
    expect(screen.getByTestId("teller-subtitel")).toHaveAttribute("data-goed", "ja");
  });

  it("het veld toont de officiële naam van de winkel tussen haakjes", async () => {
    (api.winkelsTeksten as Mock).mockResolvedValue([veld()]);
    toon();
    expect(await screen.findByText("(Subtitle)")).toBeInTheDocument();
  });

  it("een goedgekeurde tekst is vergrendeld en pas na 'Bewerken' weer te wijzigen", async () => {
    const g = { id: 3, tekst: "Vast", status: "goedgekeurd" as const, bron: "gebruiker" as const, at: 1 };
    (api.winkelsTeksten as Mock).mockResolvedValue([veld({ goedgekeurd: g })]);
    (api.winkelsTekstOntgrendel as Mock).mockResolvedValue({ ok: true });
    toon();
    const t = await screen.findByTestId("tekst-subtitel");
    expect(t).toBeDisabled();
    expect(screen.getByTestId("vergrendeld-subtitel")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-subtitel")).not.toBeInTheDocument(); // de AI kan hier niets aan doen
    fireEvent.click(screen.getByTestId("ontgrendel-subtitel"));
    await waitFor(() => expect(api.winkelsTekstOntgrendel).toHaveBeenCalledWith(1, "appstore", "nl", "subtitel"));
  });

  it("goedkeuren slaat eerst op en keurt dan goed; 'Laat de AI schrijven' noemt de limiet en het hulpmiddel", async () => {
    const vraag = vi.fn();
    (api.winkelsTeksten as Mock).mockResolvedValue([veld()]);
    (api.winkelsTekstConcept as Mock).mockResolvedValue({ id: 7 });
    (api.winkelsTekstGoedkeuren as Mock).mockResolvedValue({ ok: true });
    toon(vraag);
    fireEvent.change(await screen.findByTestId("tekst-subtitel"), { target: { value: "Mijn ondertitel" } });
    fireEvent.click(screen.getByTestId("goedkeuren-subtitel"));
    await waitFor(() => expect(api.winkelsTekstGoedkeuren).toHaveBeenCalledWith(1, 7));
    expect(api.winkelsTekstConcept).toHaveBeenCalledWith(1, "appstore", "nl", "subtitel", "Mijn ondertitel");
    fireEvent.click(screen.getByTestId("ai-subtitel"));
    expect(vraag.mock.calls[0][0]).toContain("30 tekens");
    expect(vraag.mock.calls[0][0]).toContain("winkel_schrijf_teksten");
  });

  it("een limiet die niet uit de officiële tekst komt, wordt als zodanig getoond", async () => {
    (api.winkelsTeksten as Mock).mockResolvedValue([veld({ geverifieerd: false })]);
    toon();
    const rij = await screen.findByTestId("tekst-subtitel");
    expect(within(rij.closest("li")!).getByText(/niet uit de officiële tekst/)).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import UpdateCheck from "./UpdateCheck";
import UpdateRij from "./UpdateRij";

vi.mock("@/lib/api");
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
let instellingen = { update_check: true };
let geladen = true;
vi.mock("@/components/app/settings-provider", () => ({ useSettings: () => ({ settings: instellingen, geladen }) }));

const nieuw = { status: "beschikbaar" as const, versie_nu: "0.1.0", nieuw: "0.2.0", notities: "Back-up op GitHub", datum: null };

beforeEach(() => {
  vi.resetAllMocks();
  instellingen = { update_check: true };
  geladen = true;
});

describe("bijwerken bij het openen", () => {
  it("vraagt bij een nieuwe versie of je wilt bijwerken en toont wat er nieuw is", async () => {
    (api.updateCheck as Mock).mockResolvedValue(nieuw);
    render(<UpdateCheck />);
    const d = await screen.findByTestId("update-dialoog");
    expect(d).toHaveTextContent("Versie 0.2.0 is klaar");
    expect(screen.getByTestId("update-notities")).toHaveTextContent("Back-up op GitHub");
    (api.updateInstall as Mock).mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId("update-nu"));
    await waitFor(() => expect(api.updateInstall).toHaveBeenCalledOnce());
  });

  it("'Later' sluit de vraag zonder iets te installeren", async () => {
    (api.updateCheck as Mock).mockResolvedValue(nieuw);
    render(<UpdateCheck />);
    fireEvent.click(await screen.findByTestId("update-later"));
    await waitFor(() => expect(screen.queryByTestId("update-dialoog")).not.toBeInTheDocument());
    expect(api.updateInstall).not.toHaveBeenCalled();
  });

  it("een mislukte installatie toont een duidelijke melding en niets verandert", async () => {
    (api.updateCheck as Mock).mockResolvedValue(nieuw);
    (api.updateInstall as Mock).mockRejectedValue("download_mislukt");
    render(<UpdateCheck />);
    fireEvent.click(await screen.findByTestId("update-nu"));
    expect(await screen.findByTestId("update-fout")).toHaveTextContent("Er is niets veranderd");
  });

  it("controleert niet als de gebruiker dat heeft uitgezet, en wacht tot de instellingen gelezen zijn", async () => {
    instellingen = { update_check: false };
    render(<UpdateCheck />);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.updateCheck).not.toHaveBeenCalled();
    geladen = false;
    instellingen = { update_check: true };
    const { rerender } = render(<UpdateCheck />);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.updateCheck).not.toHaveBeenCalled();
    geladen = true;
    (api.updateCheck as Mock).mockResolvedValue({ ...nieuw, status: "actueel" });
    rerender(<UpdateCheck />);
    await waitFor(() => expect(api.updateCheck).toHaveBeenCalledOnce());
  });

  it("geen internet of storing: geen foutdialoog, Studio werkt gewoon door", async () => {
    (api.updateCheck as Mock).mockRejectedValue("fout");
    render(<UpdateCheck />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("update-dialoog")).not.toBeInTheDocument();
  });
});

describe("Instellingen: nu zoeken", () => {
  it("meldt in gewone woorden: actueel, nog niet ingesteld, ontwikkelversie en fout", async () => {
    render(<UpdateRij />);
    for (const [status, tekst] of [["actueel", "Je hebt de nieuwste versie (0.1.0)"], ["niet_ingesteld", "nog niet ingesteld"], ["dev", "alleen in de gebouwde app"], ["fout", "lukte niet"]] as const) {
      (api.updateCheck as Mock).mockResolvedValue({ ...nieuw, status, nieuw: null });
      fireEvent.click(screen.getByTestId("update-zoek"));
      await waitFor(() => expect(screen.getByTestId("update-resultaat")).toHaveAttribute("data-status", status));
      expect(screen.getByTestId("update-resultaat")).toHaveTextContent(tekst);
    }
  });

  it("een nieuwe versie opent de vraag om bij te werken", async () => {
    (api.updateCheck as Mock).mockResolvedValue(nieuw);
    render(<UpdateRij />);
    fireEvent.click(screen.getByTestId("update-zoek"));
    expect(await screen.findByTestId("update-dialoog")).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import FoutBanner from "./FoutBanner";
import HerstelMelding from "./HerstelMelding";
import ProbleemRapport from "./ProbleemRapport";

vi.mock("@/lib/api");
let instellingen: Record<string, unknown> = { eerste_start_klaar: true };
vi.mock("@/components/app/settings-provider", () => ({ useSettings: () => ({ settings: instellingen, geladen: true, set: vi.fn() }) }));

beforeEach(() => {
  vi.resetAllMocks();
  instellingen = { eerste_start_klaar: true };
});

describe("FoutBanner", () => {
  it("vertaalt een technische fout en toont de details pas na een klik", () => {
    render(<FoutBanner fout="os error 28: No space left on device" onSluit={() => undefined} />);
    expect(screen.getByTestId("fout-banner")).toHaveAttribute("data-code", "schijf_vol");
    expect(screen.getByText("Je computer zit vol.")).toBeInTheDocument();
    expect(screen.queryByTestId("fout-details")).toBeNull();
    fireEvent.click(screen.getByTestId("fout-details-knop"));
    expect(screen.getByTestId("fout-details")).toHaveTextContent("No space left");
  });
  it("een melding die al gewone taal is, wordt zonder vertaling en zonder details getoond", () => {
    render(<FoutBanner fout="De map “Site” bestaat al op die locatie." onSluit={() => undefined} />);
    expect(screen.getByTestId("fout-mensentaal")).toHaveTextContent("De map “Site” bestaat al op die locatie.");
    expect(screen.queryByTestId("fout-details-knop")).toBeNull();
  });
  it("valt voor een onbekende fout terug op een algemene uitleg", () => {
    render(<FoutBanner fout="iets raars" onSluit={() => undefined} />);
    expect(screen.getByText("Er ging iets mis.")).toBeInTheDocument();
  });
});

describe("HerstelMelding", () => {
  const p = { id: 3, naam: "Mijn winkel" };
  it("vraagt na een crash of je wilt verdergaan", async () => {
    (api.startInfo as Mock).mockResolvedValue({ onderbroken: true, laatste_project: p });
    const verder = vi.fn();
    render(<HerstelMelding onVerder={verder} />);
    await waitFor(() => expect(screen.getByTestId("herstel-melding")).toHaveTextContent("Mijn winkel"));
    fireEvent.click(screen.getByTestId("herstel-verder"));
    expect(verder).toHaveBeenCalledWith(p);
  });
  it("zegt niets na een normale afsluiting", async () => {
    (api.startInfo as Mock).mockResolvedValue({ onderbroken: false, laatste_project: p });
    render(<HerstelMelding onVerder={() => undefined} />);
    await Promise.resolve();
    expect(screen.queryByTestId("herstel-melding")).toBeNull();
  });
});

describe("ProbleemRapport", () => {
  it("maakt een rapport zonder gebruikersnaam in paden", async () => {
    (api.maakProbleemrapport as Mock).mockResolvedValue("Map: /home/jan/Documenten/x");
    render(<ProbleemRapport projectId={1} onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("rapport-maak"));
    await waitFor(() => expect(screen.getByTestId("rapport-tekst")).toHaveTextContent("Map: ~/Documenten/x"));
  });
});

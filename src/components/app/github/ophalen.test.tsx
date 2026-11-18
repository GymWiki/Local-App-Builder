import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import { ConnectionsProvider } from "@/components/app/connect/connections-provider";
import OphalenDialoog from "./OphalenDialoog";

vi.mock("@/lib/api");
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@/components/app/settings-provider", () => ({ useSettings: () => ({ settings: { default_project_dir: "/projecten" } }) }));

const repos = [
  { eigenaar: "pieter", naam: "winkel", privaat: true, beschrijving: "Mijn webwinkel", bijgewerkt: "" },
  { eigenaar: "pieter", naam: "blog", privaat: false, beschrijving: "", bijgewerkt: "" },
];
const toon = (onImported = vi.fn()) =>
  render(
    <ConnectionsProvider>
      <OphalenDialoog onClose={() => undefined} onImported={onImported} />
    </ConnectionsProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  (api.connectList as Mock).mockResolvedValue([]);
  (api.githubListRepos as Mock).mockResolvedValue({ repos });
});

describe("OphalenDialoog", () => {
  it("toont de Verbinden-knop als GitHub niet gekoppeld is", async () => {
    (api.githubListRepos as Mock).mockResolvedValue({ fout: "niet_gekoppeld" });
    toon();
    expect(await screen.findByTestId("verbind-github")).toBeInTheDocument();
  });

  it("zoekt, kiest, haalt op en vertelt wat niet herkend wordt", async () => {
    const open = vi.fn();
    toon(open);
    expect(await screen.findByText("pieter/winkel")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Zoek in je projecten"), { target: { value: "blog" } });
    expect(screen.queryByText("pieter/winkel")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Zoek in je projecten"), { target: { value: "" } });
    fireEvent.click(screen.getByText("pieter/winkel"));
    const project = { id: 5, naam: "winkel", pad: "/projecten/winkel", template: "leeg", created_at: "", default_account_id: null, last_used_at: null };
    (api.githubImport as Mock).mockResolvedValue({ project, herkend: { soort: "static", template: "leeg", studio_json: false, niet_herkend: ["geen_studio_json"] } });
    fireEvent.click(screen.getByTestId("ophalen-start"));
    await waitFor(() => expect(api.githubImport).toHaveBeenCalledWith("pieter", "winkel", true, "/projecten"));
    expect(await screen.findByTestId("ophalen-niet-herkend")).toHaveTextContent("Er is geen studio.json");
    fireEvent.click(screen.getByTestId("ophalen-open"));
    expect(open).toHaveBeenCalledWith(project);
  });

  it("een bestaande map geeft een duidelijke melding", async () => {
    toon();
    fireEvent.click(await screen.findByText("pieter/blog"));
    (api.githubImport as Mock).mockResolvedValue({ fout: "map_bestaat" });
    fireEvent.click(screen.getByTestId("ophalen-start"));
    expect(await screen.findByTestId("ophalen-fout")).toHaveTextContent("Er staat al een map");
  });
});

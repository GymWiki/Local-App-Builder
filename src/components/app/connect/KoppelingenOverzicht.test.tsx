import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { KoppelInfo } from "@/lib/api";
import { ConnectionsProvider } from "./connections-provider";
import KoppelingenOverzicht from "./KoppelingenOverzicht";

vi.mock("@/lib/api");
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const mk = (id: KoppelInfo["id"], over: Partial<KoppelInfo> = {}): KoppelInfo => ({
  id,
  strategie: "token_plakken",
  status: "niet_gekoppeld",
  account: null,
  fout: null,
  rechten: [id === "github" ? "repo" : id === "vercel" ? "projecten" : "account"],
  functies: [id === "github" ? "backup" : id === "vercel" ? "onlinezetten" : "gegevens"],
  links: { signup: `https://${id}.example/signup`, token_page: `https://${id}.example/tokens`, manage: `https://${id}.example/apps` },
  bezig: null,
  verloopt: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  (api.connectStart as Mock).mockResolvedValue({ soort: "plakken" });
  (api.connectCancel as Mock).mockResolvedValue(undefined);
});

describe("KoppelingenOverzicht", () => {
  it("toont alle diensten met status en dezelfde knoppen, en legt uit dat alles op dit apparaat blijft", async () => {
    (api.connectList as Mock).mockResolvedValue([mk("github", { status: "werkt", account: "pieter" }), mk("vercel", { status: "verlopen", fout: "verlopen" }), mk("supabase")]);
    render(
      <ConnectionsProvider>
        <KoppelingenOverzicht />
      </ConnectionsProvider>,
    );
    expect(await screen.findByTestId("koppel-status-github")).toHaveTextContent("Werkt");
    expect(screen.getByTestId("koppel-status-vercel")).toHaveTextContent("Verlopen");
    expect(screen.getByTestId("koppel-status-supabase")).toHaveTextContent("Niet gekoppeld");
    expect(screen.getByText(/De toegang blijft op dit apparaat/)).toBeInTheDocument();
    expect(screen.getByText("De toegang is verlopen. Klik op ‘Opnieuw verbinden’.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opnieuw verbinden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verbind met Supabase" })).toBeInTheDocument();
  });

  it("'Alles testen' test alle diensten", async () => {
    (api.connectList as Mock).mockResolvedValue([mk("github", { status: "werkt", account: "p" })]);
    (api.connectTestAll as Mock).mockResolvedValue([]);
    render(
      <ConnectionsProvider>
        <KoppelingenOverzicht />
      </ConnectionsProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Alles testen" }));
    await waitFor(() => expect(api.connectTestAll).toHaveBeenCalled());
  });

  it("'Alles verbinden' loopt de niet-gekoppelde diensten één voor één door, met voortgang en overslaan", async () => {
    (api.connectList as Mock).mockResolvedValue([mk("github", { status: "werkt", account: "p" }), mk("vercel"), mk("supabase")]);
    render(
      <ConnectionsProvider>
        <KoppelingenOverzicht />
      </ConnectionsProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Alles verbinden" }));
    const eerste = await screen.findByTestId("verbind-dialoog-vercel");
    expect(within(eerste).getByTestId("reeks-voortgang")).toHaveTextContent("Dienst 1 van 2");
    fireEvent.click(within(eerste).getByRole("button", { name: "Overslaan" }));
    const tweede = await screen.findByTestId("verbind-dialoog-supabase");
    expect(within(tweede).getByTestId("reeks-voortgang")).toHaveTextContent("Dienst 2 van 2");
    fireEvent.click(within(tweede).getByRole("button", { name: "Overslaan" }));
    await waitFor(() => expect(screen.queryByTestId("alles-verbinden")).not.toBeInTheDocument());
  });

  it("'Alles verbinden' is uit als alles al werkt", async () => {
    (api.connectList as Mock).mockResolvedValue([mk("github", { status: "werkt", account: "p" })]);
    render(
      <ConnectionsProvider>
        <KoppelingenOverzicht />
      </ConnectionsProvider>,
    );
    expect(await screen.findByRole("button", { name: "Alles verbinden" })).toBeDisabled();
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import { geenFeiten, type RouteFeiten } from "@/lib/route";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider, type WorkspaceCtx } from "../workspace/workspace-context";
import RouteBalk from "./RouteBalk";

vi.mock("@/lib/api");

const ctx = (over: Partial<WorkspaceCtx> = {}): WorkspaceCtx =>
  ({ project: { id: 1, naam: "Winkel", pad: "/p", template: "leeg", created_at: "", default_account_id: null, last_used_at: null }, tick: 0, setVlag: vi.fn(async () => undefined), openPaneel: vi.fn(), focusGesprek: vi.fn(), onError: vi.fn(), ...over }) as unknown as WorkspaceCtx;
const toon = (c: WorkspaceCtx) =>
  render(
    <TooltipProvider>
      <WorkspaceProvider value={c}>
        <RouteBalk />
      </WorkspaceProvider>
    </TooltipProvider>,
  );
const feiten = (o: Partial<RouteFeiten>): RouteFeiten => ({ ...geenFeiten(), ...o });

beforeEach(() => {
  vi.resetAllMocks();
  (api.routeFeiten as Mock).mockResolvedValue(geenFeiten());
  (api.chatSend as Mock).mockResolvedValue(undefined);
});

describe("RouteBalk", () => {
  it("toont stap 1 van 8 met uitleg, duur en één grote knop", async () => {
    toon(ctx());
    const u = await screen.findByTestId("route-uitleg");
    expect(u).toHaveTextContent("Stap 1 van 8: Je idee.");
    expect(u).toHaveTextContent("ongeveer 2 minuten");
    expect(screen.getByTestId("route-volgende")).toHaveTextContent("Beschrijf je idee");
    expect(screen.getByTestId("route-balk").querySelectorAll("li")).toHaveLength(8);
  });

  it("het idee gaat met een voorbeeld naar de AI, met maximaal drie vragen als opdracht", async () => {
    toon(ctx());
    fireEvent.click(await screen.findByTestId("route-volgende"));
    fireEvent.click(await screen.findByTestId("idee-voorbeeld-taken"));
    fireEvent.click(screen.getByTestId("idee-stuur"));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledOnce());
    const prompt = (api.chatSend as Mock).mock.calls[0][1] as string;
    expect(prompt).toContain("takenlijst");
    expect(prompt).toContain("maximaal drie korte vragen");
    expect(prompt).toContain("Gebruik geen technische woorden");
  });

  it("het plan wordt in mensentaal getoond en 'Ja, dit klopt' zet de vlag", async () => {
    (api.routeFeiten as Mock).mockResolvedValue(feiten({ heeft_idee: true }));
    (api.projectFileRead as Mock).mockResolvedValue({ tekst: "# Doel\nEen takenlijst.\n## Schermen\n- Lijst met taken\n", ingekort: false });
    const c = ctx();
    toon(c);
    fireEvent.click(await screen.findByTestId("route-volgende"));
    expect(await screen.findByTestId("plan-tekst")).toHaveTextContent("Een takenlijst.");
    fireEvent.click(screen.getByTestId("plan-klopt"));
    await waitFor(() => expect(c.setVlag).toHaveBeenCalledWith("route_plan", "1"));
  });

  it("zonder plan biedt het scherm aan het te laten maken; aanpassen stuurt de wens", async () => {
    (api.routeFeiten as Mock).mockResolvedValue(feiten({ heeft_idee: true }));
    (api.projectFileRead as Mock).mockResolvedValue({ tekst: "# Doel\n\n## Schermen\n", ingekort: false });
    toon(ctx());
    fireEvent.click(await screen.findByTestId("route-volgende"));
    expect(await screen.findByTestId("plan-maak")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("plan-maak"));
    await waitFor(() => expect((api.chatSend as Mock).mock.calls[0][1]).toContain("eenvoudig plan in PROJECT.md"));
  });

  it("elke stap is over te slaan en daarna gaat de route door", async () => {
    const c = ctx();
    toon(c);
    fireEvent.click(await screen.findByTestId("route-overslaan"));
    await waitFor(() => expect(c.setVlag).toHaveBeenCalledWith("over_idee", "1"));
  });

  it("bouwen en testen sturen een duidelijke opdracht in gewone taal; uiterlijk en delen openen het juiste onderdeel", async () => {
    (api.routeFeiten as Mock).mockResolvedValue(feiten({ heeft_idee: true, plan_klaar: true }));
    const c = ctx();
    const { unmount } = toon(c);
    fireEvent.click(await screen.findByTestId("route-volgende"));
    expect(c.openPaneel).toHaveBeenCalledWith("uiterlijk");
    unmount();
    (api.routeFeiten as Mock).mockResolvedValue(feiten({ heeft_idee: true, plan_klaar: true, kit_gekozen: true }));
    toon(c);
    fireEvent.click(await screen.findByTestId("route-volgende"));
    await waitFor(() => expect((api.chatSend as Mock).mock.calls[0][1]).toContain("per stap in gewone taal wat je doet"));
  });

  it("is de route af, dan staat er een rustige melding in plaats van een knop", async () => {
    (api.routeFeiten as Mock).mockResolvedValue(feiten({ heeft_idee: true, plan_klaar: true, kit_gekozen: true, versies: 2, tests_ok: true, online: true }));
    toon(ctx());
    expect(await screen.findByTestId("route-klaar")).toHaveTextContent("Je app staat klaar");
    expect(screen.queryByTestId("route-volgende")).not.toBeInTheDocument();
  });
});

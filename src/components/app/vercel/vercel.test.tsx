import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { VercelState } from "@/lib/api";
import { ConnectionsProvider } from "@/components/app/connect/connections-provider";
import OnlineZetten from "./OnlineZetten";
import Variabelen from "./Variabelen";

vi.mock("@/lib/api");
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const staat = (over: Partial<VercelState> = {}): VercelState => ({ werkt: true, account: "joke", project: "hovenier-joke", flutter: false, server_deel: false, ontbrekend: [], voorbeeld: null, live: null, laatste: null, bezig: false, nu: 1_000_000, ...over });
const log = (target: "preview" | "production", url: string) => ({ id: 1, at: 1, target, deployment_id: "dpl_1", url, state: "READY", checkpoint: "abc", code: "x" });
const toon = (props: Partial<React.ComponentProps<typeof OnlineZetten>> = {}) =>
  render(
    <ConnectionsProvider>
      <OnlineZetten projectId={1} controlesGroen onVraagAi={() => undefined} {...props} />
    </ConnectionsProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  (api.connectList as Mock).mockResolvedValue([]);
  (api.vercelState as Mock).mockResolvedValue(staat());
  (api.vercelDeployments as Mock).mockResolvedValue({ lijst: [] });
  (api.vercelEnvList as Mock).mockResolvedValue([]);
});

describe("OnlineZetten", () => {
  it("niet gekoppeld: de volgende stap is de Verbinden-knop", async () => {
    (api.vercelState as Mock).mockResolvedValue(staat({ werkt: false, account: null, project: null }));
    toon();
    const v = await screen.findByTestId("online-volgende");
    expect(v).toHaveAttribute("data-stap", "gekoppeld");
    expect(await screen.findByTestId("verbind-vercel")).toBeInTheDocument();
    expect(screen.getByTestId("online-stappen").querySelector("[data-stap=controles]")).toHaveAttribute("data-klaar", "ja");
    expect(screen.getByTestId("online-stappen").querySelector("[data-stap=gekoppeld]")).toHaveAttribute("data-klaar", "nee");
  });

  it("zonder groene controles is de volgende stap herstellen door de AI", async () => {
    const vraag = vi.fn();
    toon({ controlesGroen: false, onVraagAi: vraag });
    const knop = await screen.findByRole("button", { name: "Laat de AI de controles herstellen" });
    fireEvent.click(knop);
    expect(vraag).toHaveBeenCalledOnce();
  });

  it("een voorbeeld zetten vraagt niets extra's en toont het adres met kopiëren en openen", async () => {
    toon();
    (api.vercelDeploy as Mock).mockResolvedValue({ status: "uitgevoerd", code: "voorbeeld_online", params: { url: "https://app-1.vercel.app" } });
    fireEvent.click(await screen.findByTestId("vercel-voorbeeld"));
    await waitFor(() => expect(api.vercelDeploy).toHaveBeenCalledWith(1, "preview", false));
    expect(await screen.findByTestId("vercel-adres")).toHaveTextContent("https://app-1.vercel.app");
    expect(screen.getByText("Het voorbeeld staat online. Dit is nog niet je echte site.")).toBeInTheDocument();
    expect(screen.getByTestId("vercel-kopieer")).toBeInTheDocument();
    expect(screen.getByTestId("vercel-open")).toBeInTheDocument();
    expect(screen.queryByTestId("vercel-live-dialoog")).not.toBeInTheDocument();
  });

  it("echt online zetten gaat nooit zonder bevestigingsdialoog; 'Niet doen' stuurt niets", async () => {
    const live = vi.fn();
    toon({ onLive: live });
    (api.vercelDeploy as Mock).mockResolvedValue({ status: "uitgevoerd", code: "live_online", params: { url: "https://app.vercel.app" } });
    fireEvent.click(await screen.findByTestId("vercel-live"));
    const d = await screen.findByTestId("vercel-live-dialoog");
    expect(d).toHaveTextContent("iedereen op internet kan de nieuwe versie zien");
    fireEvent.click(screen.getByTestId("vercel-live-nee"));
    expect(api.vercelDeploy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("vercel-live"));
    fireEvent.click(await screen.findByTestId("vercel-live-ja"));
    await waitFor(() => expect(api.vercelDeploy).toHaveBeenCalledWith(1, "live", true));
    await waitFor(() => expect(live).toHaveBeenCalledOnce());
  });

  it("controles die niet groen zijn: lijst met problemen en 'Laat de AI dit herstellen'", async () => {
    const vraag = vi.fn();
    toon({ onVraagAi: vraag });
    (api.vercelDeploy as Mock).mockResolvedValue({ status: "geweigerd", code: "controles", params: { problemen: [{ code: "geheimen", bestanden: [{ bestand: "src/a.ts", regel: 3, soort: "github_token" }] }, { code: "variabelen_ontbreken", namen: ["VITE_X"] }] } });
    fireEvent.click(await screen.findByTestId("vercel-voorbeeld"));
    const p = await screen.findByTestId("vercel-problemen");
    expect(p).toHaveTextContent("src/a.ts");
    expect(p).toHaveTextContent("VITE_X");
    fireEvent.click(screen.getByTestId("vercel-herstel"));
    expect(vraag.mock.calls[0][0]).toContain("src/a.ts");
  });

  it("een mislukte bouw: samenvatting in gewone taal, details en herstel met de laatste regels", async () => {
    const vraag = vi.fn();
    toon({ onVraagAi: vraag });
    (api.vercelDeploy as Mock).mockResolvedValue({ status: "mislukt", code: "bouw_mislukt", params: { soort: "module_ontbreekt", regels: ["Error: Cannot find module 'leaflet'"] } });
    fireEvent.click(await screen.findByTestId("vercel-voorbeeld"));
    const b = await screen.findByTestId("vercel-bouwfout");
    expect(b).toHaveTextContent("Een onderdeel dat je code nodig heeft, ontbreekt.");
    fireEvent.click(screen.getByTestId("vercel-herstel-bouw"));
    expect(vraag.mock.calls[0][0]).toContain("Cannot find module 'leaflet'");
  });

  it("eerdere versies: terugzetten vraagt eerst bevestiging en is er niet voor de nieuwste", async () => {
    (api.vercelState as Mock).mockResolvedValue(staat({ live: log("production", "https://app.vercel.app") }));
    (api.vercelDeployments as Mock).mockResolvedValue({ lijst: [{ id: "dpl_2", adres: "b.vercel.app", doel: "production", status: "READY", gemaakt: 1_700_000_100, versie: null }, { id: "dpl_1", adres: "a.vercel.app", doel: "production", status: "READY", gemaakt: 1_700_000_000, versie: "abc" }] });
    (api.vercelRollback as Mock).mockResolvedValue({ status: "uitgevoerd", code: "teruggezet", params: {} });
    toon();
    const knoppen = await screen.findAllByTestId("vercel-terug");
    expect(knoppen).toHaveLength(1);
    fireEvent.click(knoppen[0]);
    expect(api.vercelRollback).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("vercel-terug-ja"));
    await waitFor(() => expect(api.vercelRollback).toHaveBeenCalledWith(1, "dpl_1", true));
  });

  it("een Flutter-app krijgt een eerlijke melding en geen knoppen om online te zetten", async () => {
    (api.vercelState as Mock).mockResolvedValue(staat({ flutter: true }));
    toon();
    expect(await screen.findByTestId("vercel-flutter")).toBeInTheDocument();
    expect(screen.queryByTestId("vercel-voorbeeld")).not.toBeInTheDocument();
  });

  it("noemt de voorwaarden van het gratis plan zonder iets te beloven", async () => {
    toon();
    expect(await screen.findByTestId("vercel-voorwaarden")).toHaveTextContent("Lees ze op vercel.com");
  });
});

describe("Variabelen", () => {
  const toonVar = () =>
    render(
      <ConnectionsProvider>
        <Variabelen projectId={1} />
      </ConnectionsProvider>,
    );

  it("toont ontbrekende namen, nooit een waarde, en server is uit zonder serverdeel", async () => {
    (api.vercelState as Mock).mockResolvedValue(staat({ ontbrekend: ["VITE_WINKEL_NAAM"] }));
    (api.vercelEnvList as Mock).mockResolvedValue([{ naam: "SITE_NAAM", soort: "openbaar", bron: "handmatig", omgevingen: ["production", "preview"], gezet: 1, doorgestuurd: 1 }]);
    toonVar();
    expect(await screen.findByTestId("vercel-ontbrekend")).toHaveTextContent("VITE_WINKEL_NAAM");
    const lijst = await screen.findByTestId("vercel-env-lijst");
    expect(lijst).toHaveTextContent("Waarde bewaard in de kluis");
    expect(screen.getByRole("radio", { name: /Geheim \(server\)/ })).toBeDisabled();
    expect((screen.getByTestId("vercel-env-waarde") as HTMLInputElement).type).toBe("password");
  });

  it("voor de echte site vraagt opslaan eerst een bevestiging; een geheim als openbaar krijgt een duidelijke fout", async () => {
    toonVar();
    (api.vercelEnvSet as Mock).mockResolvedValue({ status: "geweigerd", code: "env_ongeldig", params: { reden: "geheim_als_openbaar" } });
    fireEvent.change(await screen.findByTestId("vercel-env-naam"), { target: { value: "vite_sleutel" } });
    fireEvent.change(screen.getByTestId("vercel-env-waarde"), { target: { value: "iets" } });
    fireEvent.click(screen.getByTestId("vercel-env-opslaan"));
    expect(api.vercelEnvSet).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("vercel-env-ja"));
    await waitFor(() => expect(api.vercelEnvSet).toHaveBeenCalledWith(1, "VITE_SLEUTEL", "iets", "openbaar", ["production", "preview"], true));
    expect(await screen.findByTestId("vercel-env-melding")).toHaveTextContent("Dit lijkt een geheime sleutel");
  });

  it("alleen voor voorbeelden is er geen bevestiging nodig", async () => {
    toonVar();
    (api.vercelEnvSet as Mock).mockResolvedValue({ status: "uitgevoerd", code: "env_gezet", params: {} });
    fireEvent.change(await screen.findByTestId("vercel-env-naam"), { target: { value: "SITE_NAAM" } });
    fireEvent.change(screen.getByTestId("vercel-env-waarde"), { target: { value: "Joke" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Echte site" }));
    fireEvent.click(screen.getByTestId("vercel-env-opslaan"));
    await waitFor(() => expect(api.vercelEnvSet).toHaveBeenCalledWith(1, "SITE_NAAM", "Joke", "openbaar", ["preview"], false));
  });

  it("het aanbod om Supabase over te nemen staat er alleen als Supabase gekoppeld is", async () => {
    (api.connectList as Mock).mockResolvedValue([{ id: "supabase", status: "werkt", account: "x", strategie: "token_plakken", fout: null, rechten: [], functies: [], links: { signup: "", token_page: "", manage: "" }, bezig: null, verloopt: null }]);
    toonVar();
    expect(await screen.findByTestId("vercel-supabase-aanbod")).toHaveTextContent("Een geheime sleutel gaat nooit mee");
  });
});

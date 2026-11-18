import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { SupaConfirm, SupaState } from "@/lib/api";
import { ConnectionsProvider } from "@/components/app/connect/connections-provider";
import ActieLog from "./ActieLog";
import BevestigDialoog from "./BevestigDialoog";
import Controle from "./Controle";
import NiveauKiezer from "./NiveauKiezer";
import NoodBalk from "./NoodBalk";
import OpslagKeuze from "./OpslagKeuze";
import SupabaseKoppeling from "./SupabaseKoppeling";
import Tabellen from "./Tabellen";

vi.mock("@/lib/api");
const handlers: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers[name] = cb;
    return () => undefined;
  }),
}));
const stuur = (naam: string, payload: unknown) => act(async () => handlers[naam]?.({ payload }));

const staat = (over: Partial<SupaState> = {}): SupaState => ({ gekoppeld: true, naam: "Winkel", referentie: "abcdefghij", regio: "eu-west-1", niveau: "voorzichtig", volledig_resterend: null, volledig_secs: 3600, ...over });
const vraag = (over: Partial<SupaConfirm> = {}): SupaConfirm => ({
  id: "v1", project_id: 1, tool: "db_run_sql", actor: "ai", class: 2, level: "voorzichtig", redenen: ["niveau"],
  changes: [{ code: "tabel_toevoegen", params: { tabel: "bestellingen" } }], rijen: null, verlies: false, backup: "niet_nodig", kosten: null, waarschuwingen: [], sql: "CREATE TABLE bestellingen (id int)", uitleg: "Ik maak een tabel.", ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  (api.supaState as Mock).mockResolvedValue(staat());
  (api.supaConfirmAnswer as Mock).mockResolvedValue(true);
  (api.connectList as Mock).mockResolvedValue([]);
});

describe("BevestigDialoog", () => {
  it("toont in gewone woorden wat er verandert, met 'Niet toestaan' als standaardkeuze; Escape is 'nee'", async () => {
    render(<BevestigDialoog />);
    await stuur("db-confirm", vraag());
    const dlg = await screen.findByTestId("bevestig-dialoog");
    expect(within(dlg).getByText("De AI wil iets veranderen")).toBeInTheDocument();
    expect(within(dlg).getByTestId("bevestig-wijzigingen")).toHaveTextContent("Er komt een tabel ‘bestellingen’ bij");
    expect(within(dlg).getByTestId("bevestig-ai-uitleg")).toHaveTextContent("Ik maak een tabel.");
    expect(within(dlg).getByText(/Op het niveau ‘Voorzichtig’ vraagt Studio altijd eerst/)).toBeInTheDocument();
    expect(within(dlg).getByTestId("bevestig-nee")).toHaveFocus();
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(api.supaConfirmAnswer).toHaveBeenCalledWith("v1", false));
  });

  it("toestaan stuurt 'ja' en sluit de dialoog", async () => {
    render(<BevestigDialoog />);
    await stuur("db-confirm", vraag());
    fireEvent.click(await screen.findByTestId("bevestig-ja"));
    await waitFor(() => expect(api.supaConfirmAnswer).toHaveBeenCalledWith("v1", true));
    expect(screen.queryByTestId("bevestig-dialoog")).not.toBeInTheDocument();
  });

  it("gevaarlijk met verlies: waarschuwing, aantal rijen en back-up; zonder back-up een duidelijke melding", async () => {
    render(<BevestigDialoog />);
    await stuur("db-confirm", vraag({ class: 3, verlies: true, rijen: 120, backup: "mislukt", changes: [{ code: "rijen_verwijderen", params: { tabel: "klanten" } }], redenen: ["gevaarlijk", "geen_backup"] }));
    const dlg = await screen.findByTestId("bevestig-dialoog");
    expect(within(dlg).getByTestId("bevestig-verlies")).toHaveTextContent("hiermee verdwijnen gegevens");
    expect(within(dlg).getByTestId("bevestig-verlies")).toHaveTextContent("120 rij(en)");
    expect(within(dlg).getByTestId("bevestig-wijzigingen")).toHaveTextContent("Rijen uit ‘klanten’ verdwijnen");
    expect(within(dlg).getByTestId("bevestig-backup-mislukt")).toHaveTextContent("GEEN back-up");
  });

  it("kosten: toont het plan en het bedrag", async () => {
    render(<BevestigDialoog />);
    await stuur("db-confirm", vraag({ class: 4, redenen: ["kosten"], kosten: { plan: "betaald_plan", per_maand: 10 }, changes: [{ code: "project_maken", params: { naam: "Nieuw", regio: "Europa" } }] }));
    const dlg = await screen.findByTestId("bevestig-dialoog");
    expect(within(dlg).getByText("Dit kan geld kosten")).toBeInTheDocument();
    expect(within(dlg).getByTestId("bevestig-kosten")).toHaveTextContent("ongeveer 10 dollar per maand");
  });

  it("meerdere vragen komen na elkaar; de SQL staat achter een uitklapper; AI-tekst wordt als gewone tekst getoond", async () => {
    render(<BevestigDialoog />);
    await stuur("db-confirm", vraag({ id: "a", uitleg: "<img src=x onerror=alert(1)>" }));
    await stuur("db-confirm", vraag({ id: "b" }));
    const dlg = await screen.findByTestId("bevestig-dialoog");
    expect(dlg).toHaveTextContent("Nog 1 vraag(en) wachten");
    expect(dlg.querySelector("img")).toBeNull();
    expect(within(dlg).queryByText("CREATE TABLE bestellingen (id int)")).not.toBeInTheDocument();
    fireEvent.click(within(dlg).getByTestId("bevestig-nee"));
    await waitFor(() => expect(api.supaConfirmAnswer).toHaveBeenCalledWith("a", false));
    await waitFor(() => expect(screen.getByTestId("bevestig-dialoog")).not.toHaveTextContent("wachten"));
  });
});

describe("NiveauKiezer en NoodBalk", () => {
  it("toont de drie niveaus met uitleg en voorbeeld; voorzichtig is gekozen", async () => {
    render(<NiveauKiezer projectId={1} />);
    expect(await screen.findByRole("radio", { name: /Voorzichtig/ })).toBeChecked();
    expect(screen.getByText(/Voor elke wijziging vraagt Studio eerst jouw toestemming/)).toBeInTheDocument();
    expect(screen.getByText(/Voorbeeld: de AI wil een tabel ‘bestellingen’ maken/)).toBeInTheDocument();
  });

  it("Zelfstandig kiezen kan direct", async () => {
    (api.supaSetLevel as Mock).mockResolvedValue(undefined);
    render(<NiveauKiezer projectId={1} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Zelfstandig/ }));
    await waitFor(() => expect(api.supaSetLevel).toHaveBeenCalledWith(1, "zelfstandig"));
  });

  it("Volledige controle: waarschuwing, duur, en pas na het typen van 'volledig' wordt het aangezet", async () => {
    (api.supaSetLevel as Mock).mockResolvedValue(undefined);
    (api.supaSetDuration as Mock).mockResolvedValue(undefined);
    render(<NiveauKiezer projectId={1} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Volledige controle/ }));
    const dlg = await screen.findByTestId("volledig-dialoog");
    expect(within(dlg).getByText("Volledige controle aanzetten?")).toBeInTheDocument();
    expect(api.supaSetLevel).not.toHaveBeenCalled();
    const aan = within(dlg).getByTestId("volledig-aan");
    expect(aan).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/Typ het woord/), { target: { value: "ja hoor" } });
    expect(aan).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/Typ het woord/), { target: { value: "Volledig" } });
    expect(aan).toBeEnabled();
    fireEvent.click(aan);
    await waitFor(() => expect(api.supaSetLevel).toHaveBeenCalledWith(1, "volledig", "Volledig"));
    expect(api.supaSetDuration).toHaveBeenCalledWith(1, 3600);
  });

  it("de noodknop stopt de AI direct", async () => {
    (api.supaEmergency as Mock).mockResolvedValue(undefined);
    render(<NiveauKiezer projectId={1} />);
    fireEvent.click(await screen.findByTestId("noodknop"));
    await waitFor(() => expect(api.supaEmergency).toHaveBeenCalledWith(1));
  });

  it("de rode balk staat er alleen bij volledige controle, met de resterende tijd", async () => {
    (api.supaState as Mock).mockResolvedValue(staat({ niveau: "volledig", volledig_resterend: 1800 }));
    render(<NoodBalk projectId={1} />);
    const balk = await screen.findByTestId("nood-balk");
    expect(balk).toHaveTextContent("Volledige controle staat aan");
    expect(balk).toHaveTextContent("30 min");
    (api.supaEmergency as Mock).mockResolvedValue(undefined);
    fireEvent.click(within(balk).getByTestId("nood-balk-stop"));
    await waitFor(() => expect(api.supaEmergency).toHaveBeenCalledWith(1));
  });

  it("zonder volledige controle of koppeling is er geen rode balk", async () => {
    const { container } = render(<NoodBalk projectId={1} />);
    await waitFor(() => expect(api.supaState).toHaveBeenCalled());
    expect(container.querySelector("[data-testid=nood-balk]")).toBeNull();
  });
});

describe("OpslagKeuze", () => {
  it("vraagt waar de app zijn gegevens bewaart, met advies, en legt de keuze vast", async () => {
    (api.projectStorageGet as Mock).mockResolvedValue(null);
    (api.projectStorageSet as Mock).mockResolvedValue(undefined);
    render(<OpslagKeuze projectId={1} />);
    expect(await screen.findByText("Waar moet je app zijn gegevens bewaren?")).toBeInTheDocument();
    expect(screen.getByText(/Advies: ‘Alleen op dit apparaat’ is het eenvoudigst/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Online, met inloggen/ }));
    await waitFor(() => expect(api.projectStorageSet).toHaveBeenCalledWith(1, "online"));
    expect(await screen.findByTestId("opslag-gekozen")).toHaveTextContent("Online, met inloggen en delen tussen apparaten");
  });
});

describe("SupabaseKoppeling (wizard)", () => {
  const verbonden = [{ id: "supabase", strategie: "token_plakken", status: "werkt", account: "Mijn bedrijf", fout: null, rechten: ["account"], functies: ["gegevens"], links: { signup: "", token_page: "", manage: "" }, bezig: null, verloopt: null }];

  it("zonder verbinding: alleen uitleg en de Verbind-knop (geen projectkeuze)", async () => {
    (api.supaState as Mock).mockResolvedValue(staat({ gekoppeld: false }));
    render(
      <ConnectionsProvider>
        <SupabaseKoppeling projectId={1} />
      </ConnectionsProvider>,
    );
    expect(await screen.findByRole("button", { name: "Verbind met Supabase" })).toBeInTheDocument();
    expect(screen.queryByTestId("supabase-kies")).not.toBeInTheDocument();
    expect(screen.getByText(/Je gegevens lopen alleen tussen deze computer en je eigen Supabase-account/)).toBeInTheDocument();
  });

  it("verbonden: kies een bestaand project; daarna wordt de publieke configuratie in het project gezet", async () => {
    (api.connectList as Mock).mockResolvedValue(verbonden);
    (api.supaState as Mock).mockResolvedValue(staat({ gekoppeld: false }));
    (api.supaProjects as Mock).mockResolvedValue({ projecten: [{ reference: "abcdefghij", name: "Winkel", region: "eu-west-1", status: "ACTIVE_HEALTHY" }] });
    (api.supaLink as Mock).mockResolvedValue({ status: "uitgevoerd", tekst: "Gekoppeld." });
    (api.supaWriteConfig as Mock).mockResolvedValue({ status: "uitgevoerd", tekst: "" });
    render(
      <ConnectionsProvider>
        <SupabaseKoppeling projectId={1} />
      </ConnectionsProvider>,
    );
    const kies = await screen.findByTestId("supabase-kies");
    fireEvent.click(await within(kies).findByRole("button", { name: "Dit project gebruiken" }));
    await waitFor(() => expect(api.supaLink).toHaveBeenCalledWith(1, "abcdefghij"));
    await waitFor(() => expect(api.supaWriteConfig).toHaveBeenCalledWith(1));
  });

  it("een nieuw project maken: uitleg over wachtwoord en wachttijd; de kostenbevestiging loopt via de dialoog; fout bij een limiet", async () => {
    (api.connectList as Mock).mockResolvedValue(verbonden);
    (api.supaState as Mock).mockResolvedValue(staat({ gekoppeld: false }));
    (api.supaProjects as Mock).mockResolvedValue({ projecten: [] });
    (api.supaCreate as Mock).mockResolvedValue({ status: "mislukt", tekst: "Een limiet van het Supabase-plan is bereikt." });
    render(
      <ConnectionsProvider>
        <SupabaseKoppeling projectId={1} />
      </ConnectionsProvider>,
    );
    const kies = await screen.findByTestId("supabase-kies");
    expect(await within(kies).findByText(/Studio maakt zelf een sterk wachtwoord/)).toBeInTheDocument();
    expect(within(kies).getByText(/ongeveer twee minuten/)).toBeInTheDocument();
    fireEvent.change(within(kies).getByLabelText("Naam van het nieuwe project"), { target: { value: "Mijn webwinkel" } });
    fireEvent.click(within(kies).getByTestId("supa-maak"));
    await waitFor(() => expect(api.supaCreate).toHaveBeenCalledWith(1, "Mijn webwinkel"));
    expect(await within(kies).findByTestId("supa-fout")).toBeInTheDocument();
  });

  it("gekoppeld: toont het project, wat de AI kan doen en een knop om een gepauzeerd project wakker te maken; ontkoppelen legt uit dat Supabase ongemoeid blijft", async () => {
    (api.connectList as Mock).mockResolvedValue(verbonden);
    (api.supaStatus as Mock).mockResolvedValue({ status: "uitgevoerd", tekst: "", data: { gepauzeerd: true } });
    (api.supaWake as Mock).mockResolvedValue({ status: "uitgevoerd", tekst: "" });
    (api.supaUnlink as Mock).mockResolvedValue(undefined);
    render(
      <ConnectionsProvider>
        <SupabaseKoppeling projectId={1} />
      </ConnectionsProvider>,
    );
    const ok = await screen.findByTestId("supabase-gekoppeld");
    expect(ok).toHaveTextContent("Gekoppeld aan project ‘Winkel’ (eu-west-1)");
    expect(ok).toHaveTextContent("Sleutels ziet de AI nooit");
    fireEvent.click(await within(ok).findByRole("button", { name: "Project weer wakker maken" }));
    await waitFor(() => expect(api.supaWake).toHaveBeenCalledWith(1));
    fireEvent.click(within(ok).getByRole("button", { name: "Project ontkoppelen" }));
    const vr = await screen.findByRole("alertdialog");
    expect(vr).toHaveTextContent("Er verandert niets bij Supabase");
    fireEvent.click(within(vr).getByRole("button", { name: "Project ontkoppelen" }));
    await waitFor(() => expect(api.supaUnlink).toHaveBeenCalledWith(1));
  });
});

describe("Tabellen, log en controle", () => {
  it("toont tabellen met aantallen en beveiliging; een tabel openen toont rijen met paginering", async () => {
    (api.supaTables as Mock).mockResolvedValue({ tabellen: [{ tabel: "klanten", rls: true, rijen: 3, kolommen: [{ kolom: "id", type: "integer", verplicht: true }], beleid: [] }, { tabel: "open", rls: false, rijen: 1, kolommen: [], beleid: [] }] });
    (api.supaRows as Mock).mockResolvedValue({ kolommen: ["id", "naam"], rijen: [["1", "Jan"], ["2", "Piet"]], meer: true, pagina: 0 });
    render(<Tabellen projectId={1} tick={0} />);
    const lijst = await screen.findByTestId("tabellen");
    expect(lijst).toHaveTextContent("3 rij(en)");
    expect(lijst).toHaveTextContent("Beveiligd");
    expect(lijst).toHaveTextContent("Niet beveiligd");
    fireEvent.click(screen.getByRole("button", { name: /klanten/ }));
    const rijen = await screen.findByTestId("tabel-rijen");
    expect(await within(rijen).findByText("Piet")).toBeInTheDocument();
    expect(within(rijen).getByRole("button", { name: "Volgende" })).toBeEnabled();
    expect(within(rijen).getByRole("button", { name: "Vorige" })).toBeDisabled();
    fireEvent.click(within(rijen).getByRole("button", { name: "Volgende" }));
    await waitFor(() => expect(api.supaRows).toHaveBeenLastCalledWith(1, "klanten", 1));
  });

  it("een rij wijzigen stuurt alleen de gewijzigde velden, met de oude rij als sleutel (de bevestiging volgt in de dialoog)", async () => {
    (api.supaTables as Mock).mockResolvedValue({ tabellen: [{ tabel: "klanten", rls: true, rijen: 1, kolommen: [], beleid: [] }] });
    (api.supaRows as Mock).mockResolvedValue({ kolommen: ["id", "naam"], rijen: [["1", "Jan"]], meer: false, pagina: 0 });
    (api.supaRowSave as Mock).mockResolvedValue({ status: "uitgevoerd", tekst: "" });
    render(<Tabellen projectId={1} tick={0} />);
    fireEvent.click(await screen.findByRole("button", { name: /klanten/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Wijzigen" }));
    const dlg = await screen.findByTestId("rij-dialoog");
    expect(within(dlg).getByTestId("rij-bewaar")).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("naam"), { target: { value: "Karel" } });
    fireEvent.click(within(dlg).getByTestId("rij-bewaar"));
    await waitFor(() => expect(api.supaRowSave).toHaveBeenCalledWith(1, "klanten", { id: "1", naam: "Jan" }, { naam: "Karel" }));
  });

  it("het actielog toont wat de AI deed in gewone woorden, met 'Maak ongedaan' en een eerlijke melding waar het niet kan", async () => {
    (api.supaActions as Mock).mockResolvedValue([
      { id: 3, at: 1_700_000_000, tool: "db_run_sql", class: 3, level: "zelfstandig", status: "uitgevoerd", summary: [{ code: "rijen_verwijderen", params: { tabel: "klanten" } }], detail: { backup: "gemaakt" }, kan_ongedaan: true, undone: false },
      { id: 2, at: 1_699_999_000, tool: "db_run_sql", class: 3, level: "voorzichtig", status: "geweigerd", summary: [{ code: "tabel_verwijderen", params: { tabel: "x" } }], detail: { code: "niet_toegestaan" }, kan_ongedaan: false, undone: false },
      { id: 1, at: 1_699_998_000, tool: "db_run_sql", class: 2, level: "zelfstandig", status: "uitgevoerd", summary: [{ code: "tabel_toevoegen", params: { tabel: "a" } }], detail: {}, kan_ongedaan: false, undone: false },
    ]);
    (api.supaUndo as Mock).mockResolvedValue({ status: "uitgevoerd", tekst: "" });
    render(<ActieLog projectId={1} tick={0} />);
    const acties = await screen.findAllByTestId("actie");
    expect(acties).toHaveLength(3);
    expect(acties[0]).toHaveTextContent("Rijen uit ‘klanten’ verdwijnen");
    expect(acties[0]).toHaveTextContent("Back-up gemaakt");
    expect(acties[1]).toHaveTextContent("Niet uitgevoerd");
    expect(acties[1]).toHaveTextContent("Je hebt het niet toegestaan");
    expect(acties[2]).toHaveTextContent("Dit kan niet worden teruggedraaid");
    fireEvent.click(within(acties[0]).getByTestId("ongedaan"));
    await waitFor(() => expect(api.supaUndo).toHaveBeenCalledWith(1, 3));
  });

  it("een leeg log heeft een uitleg", async () => {
    (api.supaActions as Mock).mockResolvedValue([]);
    render(<ActieLog projectId={1} tick={0} />);
    expect(await screen.findByText("De AI heeft nog niets in je database gedaan.")).toBeInTheDocument();
  });

  it("de controle toont problemen in gewone taal met 'Laat de AI dit herstellen' en meldt als alles goed is", async () => {
    (api.supaSecurityCheck as Mock).mockResolvedValue({ bevindingen: [{ code: "rls_uit", tabel: "klanten" }, { code: "geen_beleid", tabel: "orders" }] });
    (api.chatSend as Mock).mockResolvedValue(undefined);
    const { unmount } = render(<Controle projectId={1} tick={0} actief />);
    const c = await screen.findByTestId("db-controle");
    expect(c).toHaveTextContent("Tabel ‘klanten’ is niet beveiligd per rij");
    expect(c).toHaveTextContent("Tabel ‘orders’ is beveiligd maar heeft nog geen toegangsregel");
    fireEvent.click(within(c).getByTestId("db-herstel"));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(1, expect.stringContaining("rls_uit (klanten)")));
    unmount();
    (api.supaSecurityCheck as Mock).mockResolvedValue({ bevindingen: [] });
    render(<Controle projectId={1} tick={1} actief />);
    expect(await screen.findByText("Je database lijkt veilig ingesteld.")).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import ChatPanel from "./ChatPanel";
import type { ChatMessage, ChatOut, ChatTarget, Project } from "../../lib/api";
import * as api from "../../lib/api";

vi.mock("../../lib/api");

// Opvangen van de Tauri-gebeurtenissen die de chat live bijwerken.
const handlers: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers[name] = cb;
    return Promise.resolve(() => undefined);
  }),
}));
const emit = (out: ChatOut) => act(() => handlers["chat-out"]({ payload: out }));

const project: Project = { id: 1, naam: "Mijn site", pad: "/p", template: "leeg", created_at: "", default_account_id: null };
const claude: ChatTarget = { provider: "claude", account_id: null, account_label: null, structured: true, mode: "build" };
let nextId = 100;
const msg = (kind: ChatMessage["kind"], payload: ChatMessage["payload"]): ChatMessage => ({ id: nextId++, project_id: 1, kind, payload, created_at: "" });

function setup(history: ChatMessage[] = [], target: ChatTarget = claude, props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  (api.chatTarget as Mock).mockResolvedValue(target);
  (api.chatHistory as Mock).mockResolvedValue(history);
  (api.chatBusy as Mock).mockResolvedValue(false);
  (api.cliStatus as Mock).mockResolvedValue({ provider: "claude", installed: true, path: "/bin/claude", install_steps: [], docs_url: "" });
  (api.chatSend as Mock).mockResolvedValue(undefined);
  (api.chatRetry as Mock).mockResolvedValue(undefined);
  (api.permissionAnswer as Mock).mockResolvedValue(undefined);
  const onOpenAdvanced = vi.fn();
  const utils = render(
    <ChatPanel project={project} accounts={[]} technical={false} onOpenAdvanced={onOpenAdvanced} onOpenAccounts={vi.fn()} onError={vi.fn()} {...props} />,
  );
  return { ...utils, onOpenAdvanced };
}

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe("ChatPanel: gesprek", () => {
  it("toont een groot invoerveld met een placeholder in gewone taal en een uitnodigende lege staat", async () => {
    setup();
    expect(await screen.findByPlaceholderText("Beschrijf wat je wilt maken...")).toBeInTheDocument();
    expect(screen.getByText(/Vertel in gewone woorden wat je wilt maken/)).toBeInTheDocument();
    expect(screen.getByLabelText("Wat wil je maken of veranderen?")).toBeInTheDocument();
  });

  it("toont geschiedenis als tekstballonnen met eenvoudige opmaak", async () => {
    setup([msg("user", { text: "Maak een bakkerijsite" }), msg("assistant", { text: "Ik maak **een mooie** pagina.\n\n- koptekst\n- foto's" })]);
    expect(await screen.findByTestId("bubble-user")).toHaveTextContent("Maak een bakkerijsite");
    const ai = screen.getByTestId("bubble-ai");
    expect(within(ai).getByText("een mooie").tagName).toBe("STRONG");
    expect(within(ai).getAllByRole("listitem")).toHaveLength(2);
  });

  it("verstuurt met de knop en met Enter (maar niet met Shift+Enter) en maakt het veld leeg", async () => {
    setup();
    const input = await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    fireEvent.change(input, { target: { value: "Maak een site" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(api.chatSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(1, "Maak een site"));
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.change(input, { target: { value: "Nog iets" } });
    fireEvent.click(screen.getByRole("button", { name: "Versturen" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(1, "Nog iets"));
  });

  it("snelle acties sturen een vooraf geschreven opdracht", async () => {
    setup();
    await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    for (const [knop, woord] of [["Maak het mooier", "mooier"], ["Maak het mobielvriendelijk", "telefoon"], ["Er klopt iets niet", "foutmeldingen"], ["Wat is er veranderd?", "veranderd"]]) {
      fireEvent.click(screen.getByRole("button", { name: knop }));
      await waitFor(() => expect(api.chatSend).toHaveBeenLastCalledWith(1, expect.stringContaining(woord)));
    }
    expect(api.chatSend).toHaveBeenCalledTimes(4);
  });

  it("de statusregel volgt wat de AI doet: nadenken, bestanden aanpassen, klaar", async () => {
    setup();
    await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    const line = screen.getByTestId("status-line");
    expect(line).toHaveTextContent("Klaar om te helpen");
    await emit({ type: "status", project_id: 1, state: "thinking", busy: true });
    expect(line).toHaveTextContent("Bezig met nadenken");
    await emit({ type: "status", project_id: 1, state: "editing", busy: true });
    expect(line).toHaveTextContent("Bestanden aanpassen");
    await emit({ type: "status", project_id: 1, state: "checking", busy: true });
    expect(line).toHaveTextContent("Controleert of alles werkt");
    await emit({ type: "status", project_id: 1, state: "done", busy: false });
    expect(line).toHaveTextContent("Klaar");
    // gebeurtenissen van een ander project worden genegeerd
    await emit({ type: "status", project_id: 2, state: "thinking", busy: true });
    expect(line).toHaveTextContent("Klaar");
  });

  it("nieuwe berichten verschijnen live en een kaart wordt bijgewerkt in plaats van dubbel getoond", async () => {
    setup();
    await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    const card = msg("action", { kind: "file_created", params: { file: "index.html", page: true }, detail: "/p/index.html", state: "running", fixed: false, summary: "" });
    await emit({ type: "message", project_id: 1, message: card });
    expect(screen.getAllByTestId("action-card")).toHaveLength(1);
    await emit({ type: "update", project_id: 1, message: { ...card, payload: { ...card.payload, state: "done" } } });
    expect(screen.getAllByTestId("action-card")).toHaveLength(1);
    expect(screen.getByTestId("action-card")).toHaveAttribute("data-state", "done");
  });
});

describe("ChatPanel: actiekaartjes in mensentaal", () => {
  const card = (payload: Partial<ChatMessage["payload"]>) =>
    msg("action", { kind: "file_created", params: {}, detail: "", state: "done", fixed: false, summary: "", ...payload });

  it("vertaalt acties en verbergt commando's en paden standaard", async () => {
    setup([
      card({ kind: "file_created", params: { file: "index.html", page: true }, detail: "/home/u/site/index.html" }),
      card({ kind: "run_checks", detail: "npm run build", summary: "src/main.ts(4,7): error TS2322" }),
      card({ kind: "save_version", params: { message: "Eerste pagina" } }),
      card({ kind: "run_command", params: { command: "node x.js" }, detail: "node x.js" }),
    ]);
    expect(await screen.findByText("Pagina gemaakt: index.html")).toBeInTheDocument();
    expect(screen.getByText(/Controleert of alles werkt/)).toBeInTheDocument();
    expect(screen.getByText("Slaat een versie op: Eerste pagina")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    for (const raw of ["npm run build", "TS2322", "/home/u/site", "node x.js"]) expect(text, raw).not.toContain(raw);
  });

  it("details zijn uitklapbaar en tonen dan de ruwe tekst", async () => {
    setup([card({ kind: "run_checks", detail: "npm run build", summary: "error TS2322" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Details" }));
    expect(screen.getByTestId("action-details")).toHaveTextContent("npm run build");
    expect(screen.getByTestId("action-details")).toHaveTextContent("TS2322");
    fireEvent.click(screen.getByRole("button", { name: "Verberg details" }));
    expect(screen.queryByTestId("action-details")).not.toBeInTheDocument();
  });

  it("in de technische stand staan de details standaard open", async () => {
    setup([card({ kind: "run_checks", detail: "npm run build", summary: "ok" })], claude, { technical: true });
    expect(await screen.findByTestId("action-details")).toHaveTextContent("npm run build");
  });

  it("'foutje gevonden en hersteld' en een mislukte controle krijgen eigen teksten", async () => {
    setup([card({ kind: "run_checks", state: "error", summary: "CHECKS MISLUKT" }), card({ kind: "run_checks", fixed: true })]);
    expect(await screen.findByText("Controle: er klopt nog iets niet")).toBeInTheDocument();
    expect(screen.getByText("Foutje gevonden en hersteld")).toBeInTheDocument();
  });

  it("een kaart die nog 'bezig' staat uit een oude sessie wordt als klaar getoond", async () => {
    setup([card({ kind: "install_packages", state: "running" })]);
    expect(await screen.findByTestId("action-card")).toHaveAttribute("data-state", "done");
  });
});

describe("ChatPanel: toestemmingen", () => {
  const ask = (payload: Partial<ChatMessage["payload"]>) =>
    msg("permission", { req_id: "req-1", kind: "install_packages", params: {}, detail: "npm install vite", danger: false, outside_project: false, state: "asked", ...payload });

  it("toont een dialoog in gewone taal met Ja en Nee en geeft het antwoord door", async () => {
    setup([ask({})]);
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Mag de AI onderdelen installeren?");
    expect(dlg).toHaveTextContent("Hulponderdelen worden van internet gehaald");
    expect(screen.queryByText(/npm install vite/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    await waitFor(() => expect(api.permissionAnswer).toHaveBeenCalledWith(1, "req-1", true));
  });

  it("'Nee' weigert", async () => {
    setup([ask({})]);
    fireEvent.click(await screen.findByRole("button", { name: "Nee" }));
    await waitFor(() => expect(api.permissionAnswer).toHaveBeenCalledWith(1, "req-1", false));
  });

  it("gevaarlijke acties: waarschuwing en 'Nee' heeft de focus", async () => {
    setup([ask({ kind: "delete_files", danger: true, detail: "rm -rf dist" })]);
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Mag de AI iets verwijderen?");
    expect(within(dlg).getByRole("note")).toHaveTextContent("kan niet gemakkelijk worden teruggedraaid");
    await waitFor(() => expect(screen.getByRole("button", { name: "Nee" })).toHaveFocus());
  });

  it("een nieuwe vraag verschijnt live en verdwijnt zodra ze beantwoord is", async () => {
    setup();
    await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    const m = ask({ kind: "file_created", params: { file: "index.html" }, detail: "/p/index.html" });
    await emit({ type: "message", project_id: 1, message: m });
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Mag de AI dit bestand maken?");
    await emit({ type: "update", project_id: 1, message: { ...m, payload: { ...m.payload, state: "allowed" } } });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("permission-record")).toHaveTextContent("Toestemming gegeven");
  });

  it("buiten het project krijgt een eigen vraag", async () => {
    setup([ask({ kind: "file_edited", outside_project: true, params: { file: "hosts" } })]);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("buiten je project");
  });
});

describe("ChatPanel: fouten in mensentaal", () => {
  const err = (payload: Partial<ChatMessage["payload"]>) => msg("error", { code: "network", technical: "getaddrinfo ENOTFOUND api.anthropic.com", retry: true, ...payload });

  it("korte uitleg, 'Probeer opnieuw' en technische details die uitklappen", async () => {
    setup([msg("user", { text: "hoi" }), err({})]);
    const card = await screen.findByTestId("error-card");
    expect(card).toHaveTextContent("Geen verbinding met internet");
    expect(screen.queryByTestId("error-details")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Technische details" }));
    expect(screen.getByTestId("error-details")).toHaveTextContent("ENOTFOUND");
    fireEvent.click(within(card).getByRole("button", { name: "Probeer opnieuw" }));
    await waitFor(() => expect(api.chatRetry).toHaveBeenCalledWith(1));
  });

  it("niet ingelogd verwijst naar AI-accounts", async () => {
    const onOpenAccounts = vi.fn();
    setup([err({ code: "not_logged_in", technical: "Invalid API key" })], claude, { onOpenAccounts });
    fireEvent.click(await screen.findByRole("button", { name: "Naar AI-accounts" }));
    expect(onOpenAccounts).toHaveBeenCalled();
  });

  it("alleen de laatste fout biedt 'Probeer opnieuw' aan", async () => {
    setup([err({ code: "overloaded" }), err({ code: "rate_limit" })]);
    await screen.findAllByTestId("error-card");
    expect(screen.getAllByRole("button", { name: "Probeer opnieuw" })).toHaveLength(1);
  });

  it("onbekende foutcodes vallen terug op een algemene uitleg", async () => {
    setup([err({ code: "iets_nieuws" })]);
    expect(await screen.findByTestId("error-card")).toHaveTextContent("Er ging iets mis");
  });
});

describe("ChatPanel: terugval naar de terminal", () => {
  it("een AI zonder chatweergave toont uitleg en opent de technische weergave; invoer is uitgeschakeld", async () => {
    const gemini: ChatTarget = { provider: "gemini", account_id: null, account_label: null, structured: false, mode: "build" };
    const { onOpenAdvanced } = setup([], gemini);
    const note = await screen.findByTestId("terminal-fallback");
    expect(note).toHaveTextContent("Deze AI werkt nog niet in de chat");
    expect(note).toHaveTextContent("Gemini");
    expect(screen.getByPlaceholderText("Beschrijf wat je wilt maken...")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Maak het mooier" })).toBeDisabled();
    fireEvent.click(within(note).getByRole("button", { name: "Technische weergave" }));
    expect(onOpenAdvanced).toHaveBeenCalled();
    expect(api.chatSend).not.toHaveBeenCalled();
  });

  it("valt ook tijdens het gesprek terug als de CLI geen gestructureerde uitvoer levert", async () => {
    setup();
    await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    await emit({ type: "fallback", project_id: 1, reason: "unstructured" });
    expect(await screen.findByTestId("terminal-fallback")).toHaveTextContent("werkt niet met deze versie");
    expect(screen.getByPlaceholderText("Beschrijf wat je wilt maken...")).toBeDisabled();
  });

  it("zonder geïnstalleerde AI toont de chat installatie-uitleg in plaats van te versturen", async () => {
    setup();
    (api.cliStatus as Mock).mockResolvedValue({ provider: "claude", installed: false, path: null, install_steps: [{ label: "macOS", command: "curl x" }], docs_url: "x" });
    const input = await screen.findByPlaceholderText("Beschrijf wat je wilt maken...");
    fireEvent.change(input, { target: { value: "hoi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByTestId("install-guide")).toBeInTheDocument();
    expect(api.chatSend).not.toHaveBeenCalled();
  });
});

describe("ChatPanel: plan-modus (eerst overleggen)", () => {
  it("toont de schakelaar met Bouwen als standaard en onthoudt een keuze via de backend", async () => {
    (api.chatModeSet as Mock).mockResolvedValue(undefined);
    setup();
    const build = await screen.findByRole("radio", { name: "Bouwen" });
    expect(build).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radiogroup", { name: "Wat moet de AI nu doen?" })).toBeInTheDocument();
    expect(screen.queryByTestId("plan-banner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Eerst overleggen" }));
    await waitFor(() => expect(api.chatModeSet).toHaveBeenCalledWith(1, "plan"));
    expect(screen.getByRole("radio", { name: "Eerst overleggen" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("plan-banner")).toHaveTextContent("past niets aan");
    expect(screen.getByPlaceholderText("Vertel wat je wilt; we bespreken eerst een plan...")).toBeInTheDocument();
  });

  it("begint in overleg-modus als het project zo was ingesteld (per project onthouden)", async () => {
    setup([], { ...claude, mode: "plan" });
    expect(await screen.findByRole("radio", { name: "Eerst overleggen" })).toHaveAttribute("aria-checked", "true");
  });

  it("de modus volgt gebeurtenissen: een goedgekeurd plan zet de schakelaar op Bouwen", async () => {
    setup([], { ...claude, mode: "plan" });
    await screen.findByRole("radio", { name: "Bouwen" });
    await emit({ type: "mode", project_id: 1, mode: "build" });
    expect(screen.getByRole("radio", { name: "Bouwen" })).toHaveAttribute("aria-checked", "true");
    await emit({ type: "mode", project_id: 2, mode: "plan" });
    expect(screen.getByRole("radio", { name: "Bouwen" })).toHaveAttribute("aria-checked", "true");
  });

  it("het plan van de AI verschijnt als vraag in gewone taal met 'Ja, bouw dit' en 'Nee, nog even overleggen'", async () => {
    const m = msg("permission", { req_id: "p1", kind: "plan", tool: "ExitPlanMode", params: {}, detail: "# Plan\n- Een pagina met een kop\n- Een bestelknop", danger: false, outside_project: false, plan_exit: true, state: "asked" });
    setup([m], { ...claude, mode: "plan" });
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Wil je dat de AI dit plan gaat bouwen?");
    expect(screen.getByTestId("plan-text")).toHaveTextContent("Een bestelknop");
    fireEvent.click(within(dlg).getByRole("button", { name: "Ja, bouw dit" }));
    await waitFor(() => expect(api.permissionAnswer).toHaveBeenCalledWith(1, "p1", true));
  });

  it("'Nee, nog even overleggen' weigert het plan", async () => {
    setup([msg("permission", { req_id: "p2", kind: "plan", tool: "ExitPlanMode", params: {}, detail: "x", danger: false, outside_project: false, plan_exit: true, state: "asked" })], { ...claude, mode: "plan" });
    fireEvent.click(await screen.findByRole("button", { name: "Nee, nog even overleggen" }));
    await waitFor(() => expect(api.permissionAnswer).toHaveBeenCalledWith(1, "p2", false));
  });
});

describe("ChatPanel: bug-lus bewaker", () => {
  const alert = (payload: Partial<ChatMessage["payload"]> = {}) =>
    msg("loop_alert", { reason: "same_error", streak: 3, threshold: 3, last_working: { hash: "g".repeat(40), title: "Pagina werkt" }, ...payload });

  it("onderbreekt vriendelijk met drie knoppen en legt uit wat er aan de hand is", async () => {
    setup([alert()]);
    const card = await screen.findByTestId("loop-alert");
    expect(card).toHaveTextContent("Even pauzeren");
    expect(card).toHaveTextContent("dezelfde fout aan, 3 keer na elkaar");
    for (const knop of ["Terug naar laatste werkende versie", "Eerst overleggen", "Andere AI proberen"]) {
      expect(within(card).getByRole("button", { name: knop })).toBeInTheDocument();
    }
  });

  it("andere redenen krijgen een eigen uitleg", async () => {
    setup([alert({ reason: "worse" })]);
    expect(await screen.findByTestId("loop-alert")).toHaveTextContent("slechter");
  });

  it("'Terug naar laatste werkende versie' vraagt bevestiging en zet daarna veilig terug", async () => {
    (api.runtime as Mock).mockResolvedValue({ unchanged: false, safety: "s", hash: "n" });
    setup([alert()]);
    fireEvent.click(await screen.findByRole("button", { name: "Terug naar laatste werkende versie" }));
    const dlg = await screen.findByRole("alertdialog", { name: "Terug naar laatste werkende versie" });
    expect(dlg).toHaveTextContent("Pagina werkt");
    expect(dlg).toHaveTextContent("niets verloren");
    expect(api.runtime).not.toHaveBeenCalledWith(1, "git.restore", expect.anything());
    fireEvent.click(within(dlg).getByRole("button", { name: "Ja, ga terug" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(1, "git.restore", { hash: "g".repeat(40) }));
    expect(within(screen.getByTestId("loop-alert")).getByRole("status")).toHaveTextContent("Klaar: je project staat weer bij ‘Pagina werkt’");
  });

  it("zonder werkende versie is die knop uitgeschakeld en staat er waarom", async () => {
    setup([alert({ last_working: null })]);
    expect(await screen.findByRole("button", { name: "Terug naar laatste werkende versie" })).toBeDisabled();
    expect(screen.getByText(/nog geen werkende versie/)).toBeInTheDocument();
  });

  it("'Eerst overleggen' zet de plan-modus aan en vraagt de AI om uit te leggen wat er misgaat", async () => {
    (api.chatModeSet as Mock).mockResolvedValue(undefined);
    setup([alert()]);
    const card = await screen.findByTestId("loop-alert");
    fireEvent.click(within(card).getByRole("button", { name: "Eerst overleggen" }));
    await waitFor(() => expect(api.chatModeSet).toHaveBeenCalledWith(1, "plan"));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(1, expect.stringContaining("Leg in gewone woorden uit wat er misgaat")));
  });

  it("'Andere AI proberen' opent het wisselscherm met overdracht via PROJECT.md", async () => {
    setup([alert()]);
    fireEvent.click(await screen.findByRole("button", { name: "Andere AI proberen" }));
    expect(await screen.findByRole("dialog", { name: "Wissel van AI" })).toHaveTextContent("PROJECT.md");
  });

  it("oudere meldingen hebben geen knoppen meer; alleen de laatste", async () => {
    setup([alert(), msg("assistant", { text: "tussendoor" }), alert({ streak: 4 })]);
    await screen.findAllByTestId("loop-alert");
    expect(screen.getAllByRole("button", { name: "Andere AI proberen" })).toHaveLength(1);
  });
});

describe("ChatPanel: versies", () => {
  it("toont een automatisch opgeslagen versie als rustige regel in het gesprek en opent de tijdlijn", async () => {
    setup([msg("assistant", { text: "Klaar!" }), msg("version", { hash: "abc", title: "Bestelknop toegevoegd" })]);
    expect(await screen.findByTestId("version-line")).toHaveTextContent("Versie opgeslagen: Bestelknop toegevoegd");
    (api.runtime as Mock).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Versies" }));
    expect(await screen.findByRole("dialog", { name: "Versies van je project" })).toBeInTheDocument();
  });
});

describe("ChatPanel: wisselen van AI en terugvallen", () => {
  it("'Wissel van AI' kiest een andere AI en meldt de scheiding", async () => {
    (api.chatSwitch as Mock).mockResolvedValue({ provider: "gemini", account_id: null, account_label: null, structured: false, mode: "build" });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Wissel van AI" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("PROJECT.md");
    fireEvent.click(within(dlg).getByRole("button", { name: /Gemini/ }));
    await waitFor(() => expect(api.chatSwitch).toHaveBeenCalledWith(1, "gemini", null));
    expect(await screen.findByTestId("terminal-fallback")).toBeInTheDocument();
  });

  it("toont scheidingen in het gesprek", async () => {
    setup([msg("divider", { kind: "switched", provider: "claude", label: "Werk" })]);
    expect(await screen.findByRole("separator")).toHaveTextContent("Gewisseld naar claude · Werk");
  });
});

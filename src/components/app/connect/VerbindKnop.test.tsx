import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import * as api from "@/lib/api";
import type { KoppelInfo } from "@/lib/api";
import { ConnectionsProvider } from "./connections-provider";
import VerbindKnop from "./VerbindKnop";

vi.mock("@/lib/api");
let melding: (() => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_e: string, cb: () => void) => {
    melding = cb;
    return () => undefined;
  }),
}));

const info = (over: Partial<KoppelInfo> = {}): KoppelInfo => ({
  id: "github",
  strategie: "token_plakken",
  status: "niet_gekoppeld",
  account: null,
  fout: null,
  rechten: ["repo"],
  functies: ["backup"],
  links: { signup: "https://github.com/signup", token_page: "https://github.com/settings/tokens/new", manage: "https://github.com/settings/applications" },
  bezig: null,
  verloopt: null,
  ...over,
});

let huidig: KoppelInfo;
function setup(over: Partial<KoppelInfo> = {}, props: Partial<React.ComponentProps<typeof VerbindKnop>> = {}) {
  huidig = info(over);
  (api.connectList as Mock).mockImplementation(async () => [huidig]);
  render(
    <ConnectionsProvider>
      <VerbindKnop id="github" {...props} />
    </ConnectionsProvider>,
  );
}
const ververs = async (nieuw: Partial<KoppelInfo>) => {
  huidig = { ...huidig, ...nieuw };
  await act(async () => melding?.());
};

beforeEach(() => {
  vi.resetAllMocks();
  melding = null;
  (api.connectCancel as Mock).mockResolvedValue(undefined);
  (api.connectOpen as Mock).mockResolvedValue(undefined);
});

describe("VerbindKnop", () => {
  it("niet gekoppeld: 'Verbind met GitHub'", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "Verbind met GitHub" })).toBeInTheDocument();
  });

  it("sleutel plakken: drie stappen, verborgen veld met tonen, en de sleutel verdwijnt na het verbinden", async () => {
    (api.connectStart as Mock).mockResolvedValue({ soort: "plakken" });
    (api.connectPaste as Mock).mockImplementation(async () => {
      huidig = { ...huidig, status: "werkt", account: "pieter" };
      return huidig;
    });
    const onConnected = vi.fn();
    setup({}, { onConnected });
    fireEvent.click(await screen.findByRole("button", { name: "Verbind met GitHub" }));
    const dlg = await screen.findByTestId("verbind-dialoog-github");
    expect(await within(dlg).findByText(/Heb je een account bij GitHub/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Maak een toegangssleutel/)).toBeInTheDocument();
    const veld = within(dlg).getByLabelText("Toegangssleutel") as HTMLInputElement;
    expect(veld.type).toBe("password"); // verborgen
    fireEvent.click(within(dlg).getByRole("button", { name: "Toon" }));
    expect(veld.type).toBe("text");
    const knop = within(dlg).getByRole("button", { name: "Verbinden" });
    expect(knop).toBeDisabled();
    fireEvent.change(veld, { target: { value: "ghp_geheim" } });
    fireEvent.click(knop);
    await waitFor(() => expect(api.connectPaste).toHaveBeenCalledWith("github", "ghp_geheim"));
    expect(await screen.findByText(/Gelukt! Je bent verbonden met GitHub/)).toBeInTheDocument();
    expect(screen.getByText(/Ingelogd als pieter/, { selector: "span" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("ghp_geheim"); // nergens meer zichtbaar
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
  });

  it("een ongeldige sleutel toont een gewone melding en bewaart niets", async () => {
    (api.connectStart as Mock).mockResolvedValue({ soort: "plakken" });
    (api.connectPaste as Mock).mockRejectedValue("ongeldig_token");
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Verbind met GitHub" }));
    const dlg = await screen.findByTestId("verbind-dialoog-github");
    fireEvent.change(await within(dlg).findByLabelText("Toegangssleutel"), { target: { value: "fout" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Verbinden" }));
    expect(await within(dlg).findByTestId("verbind-fout")).toHaveTextContent("Deze sleutel werkt niet");
    expect(screen.queryByText(/Gelukt!/)).not.toBeInTheDocument();
  });

  it("apparaatcode: de code staat groot, met 'Open de pagina' en kopiëren; klaar zodra Rust meldt dat het werkt", async () => {
    (api.connectStart as Mock).mockImplementation(async () => {
      huidig = { ...huidig, status: "bezig", bezig: { soort: "apparaat", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900 } };
      return { soort: "apparaat", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900 };
    });
    setup({ strategie: "oauth_device" });
    fireEvent.click(await screen.findByRole("button", { name: "Verbind met GitHub" }));
    const code = await screen.findByTestId("apparaat-code");
    expect(code).toHaveTextContent("ABCD-1234");
    fireEvent.click(within(code).getByRole("button", { name: "Open de pagina" }));
    expect(api.connectOpen).toHaveBeenCalledWith("https://github.com/login/device");
    expect(within(code).getByRole("button", { name: "Kopieer de code" })).toBeInTheDocument();
    await ververs({ status: "werkt", account: "pieter", bezig: null });
    expect(await screen.findByText(/Gelukt!/)).toBeInTheDocument();
  });

  it("inloggen via de browser: 'Kopieer de link' als de browser niet opent; geweigerd geeft een duidelijke fout", async () => {
    (api.connectStart as Mock).mockImplementation(async () => {
      huidig = { ...huidig, status: "bezig", bezig: { soort: "browser", url: "https://dienst/auth?x=1" } };
      return { soort: "browser", url: "https://dienst/auth?x=1" };
    });
    setup({ strategie: "oauth_loopback_pkce" });
    fireEvent.click(await screen.findByRole("button", { name: "Verbind met GitHub" }));
    const wacht = await screen.findByTestId("browser-wacht");
    expect(within(wacht).getByRole("button", { name: "Kopieer de link" })).toBeInTheDocument();
    expect(within(wacht).getByText(/Opent je browser niet/)).toBeInTheDocument();
    await ververs({ status: "niet_gekoppeld", bezig: null, fout: "geweigerd" });
    expect(await screen.findByTestId("verbind-fout")).toHaveTextContent("Je hebt geen toestemming gegeven");
  });

  it("annuleren stopt de poging", async () => {
    (api.connectStart as Mock).mockResolvedValue({ soort: "plakken" });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Verbind met GitHub" }));
    const dlg = await screen.findByTestId("verbind-dialoog-github");
    fireEvent.click(await within(dlg).findByRole("button", { name: "Annuleren" }));
    expect(api.connectCancel).toHaveBeenCalledWith("github");
  });

  it("gekoppeld: accountnaam met ✓ en een menu met testen, opnieuw verbinden en ontkoppelen (met uitleg en link)", async () => {
    (api.connectDisconnect as Mock).mockImplementation(async () => {
      huidig = info();
      return { ingetrokken: false, beheer_url: "https://github.com/settings/applications" };
    });
    setup({ status: "werkt", account: "pieter" });
    const knop = await screen.findByRole("button", { name: "Opties voor GitHub" });
    expect(knop).toHaveTextContent("GitHub: pieter");
    fireEvent.pointerDown(knop, { button: 0, ctrlKey: false });
    fireEvent.click(knop);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Opnieuw verbinden" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Testen" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Ontkoppelen" }));
    const vraag = await screen.findByRole("alertdialog");
    expect(vraag).toHaveTextContent(/verwijdert je sleutel van deze computer/);
    expect(vraag).toHaveTextContent(/ook bij GitHub zelf intrekken/);
    fireEvent.click(within(vraag).getByTestId("ontkoppel-bevestig"));
    await waitFor(() => expect(api.connectDisconnect).toHaveBeenCalledWith("github"));
    const klaar = await screen.findByText(/GitHub is ontkoppeld/);
    expect(klaar).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open de pagina van GitHub om toegang in te trekken/ }));
    expect(api.connectOpen).toHaveBeenCalledWith("https://github.com/settings/applications");
  });

  it("verlopen: 'Opnieuw verbinden'; bezig: 'Bezig…'", async () => {
    setup({ status: "verlopen", fout: "verlopen" });
    const knop = await screen.findByRole("button", { name: "Opnieuw verbinden" });
    expect(knop).toHaveAttribute("data-status", "verlopen");
  });
  it("bezig toont 'Bezig…'", async () => {
    setup({ status: "bezig" });
    expect(await screen.findByRole("button", { name: "Bezig…" })).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import PublishPanel from "./PublishPanel";
import * as api from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const project = { id: 3, naam: "Kapsalon", pad: "/p", template: "leeg", created_at: "", default_account_id: null, last_used_at: null };

describe("PublishPanel: online zetten", () => {
  it("legt uit wat nodig is en laat de AI helpen", async () => {
    (api.chatSend as Mock).mockResolvedValue(undefined);
    render(<PublishPanel project={project} onError={vi.fn()} />);
    expect(screen.getByText(/Een eigen adres, zoals jouwbedrijf\.nl/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vraag de AI om hulp hierbij" }));
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(3, expect.stringContaining("online zetten")));
  });
});

describe("PublishPanel: Download je project", () => {
  it("zegt dat de code van de gebruiker is en wat er niet in zit", () => {
    render(<PublishPanel project={project} onError={vi.fn()} />);
    expect(screen.getByText(/De code is van jou\. Hij zit niet vast aan Studio/)).toBeInTheDocument();
    expect(screen.getByText(/geheimen zoals \.env-bestanden/)).toBeInTheDocument();
  });

  it("vraagt waar de zip moet komen, maakt hem en meldt wat bewust is weggelaten", async () => {
    (api.kiesZipBestand as Mock).mockResolvedValue("/dl/Kapsalon.zip");
    (api.exportProject as Mock).mockResolvedValue({ path: "/dl/Kapsalon.zip", files: 12, bytes: 1, skipped_secrets: [".env", "sleutel.pem"], skipped_large: [] });
    render(<PublishPanel project={project} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download je project" }));
    await waitFor(() => expect(api.exportProject).toHaveBeenCalledWith(3, "/dl/Kapsalon.zip"));
    expect(api.kiesZipBestand).toHaveBeenCalledWith("Kapsalon.zip");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Klaar: 12 bestanden opgeslagen in /dl/Kapsalon.zip."));
    expect(await screen.findByText(/bewust niet meegenomen: \.env, sleutel\.pem/)).toBeInTheDocument();
  });

  it("doet niets als de gebruiker het opslaan annuleert", async () => {
    (api.kiesZipBestand as Mock).mockResolvedValue(null);
    render(<PublishPanel project={project} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download je project" }));
    await waitFor(() => expect(api.kiesZipBestand).toHaveBeenCalled());
    expect(api.exportProject).not.toHaveBeenCalled();
  });

  it("toont een fout in gewone taal", async () => {
    (api.kiesZipBestand as Mock).mockResolvedValue("/dl/x.zip");
    (api.exportProject as Mock).mockRejectedValue("Sla de zip buiten je projectmap op.");
    const onError = vi.fn();
    render(<PublishPanel project={project} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Download je project" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Er ging iets mis: Sla de zip buiten je projectmap op."));
  });
});

describe("PublishPanel: Controleer veiligheid", () => {
  const rapport = {
    scanned: 14,
    findings: [
      { code: "api_key", severity: "hoog", file: "src/api.ts", line: 3, detail: "Anthropic-sleutel: sk-a********" },
      { code: "db_rules_missing", severity: "hoog", file: "supabase/migrations/001.sql", detail: "De tabel ‘klanten’ heeft geen toegangsregels (row level security)." },
      { code: "password", severity: "midden", file: "src/db.ts", line: 1, detail: "Vast wachtwoord in de code: S3cu********" },
    ],
  };

  it("toont de bevindingen in gewone taal, waarschuwt zonder te blokkeren, en elk punt heeft ‘Los dit op’", async () => {
    (api.runtime as Mock).mockResolvedValue(rapport);
    (api.chatSend as Mock).mockResolvedValue(undefined);
    render(<PublishPanel project={project} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Controleer veiligheid" }));
    expect(await screen.findByText("3 punt(en) gevonden. Je kunt nog steeds publiceren, maar los deze eerst op als je kunt.")).toBeInTheDocument();
    expect(api.runtime).toHaveBeenCalledWith(3, "security.check");
    expect(screen.getByText("Een geheime sleutel staat in je code")).toBeInTheDocument();
    expect(screen.getByText("Je database heeft geen toegangsregels")).toBeInTheDocument();
    expect(screen.getByText(/Studio houdt je niet tegen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download je project" })).toBeEnabled(); // publiceren blijft mogelijk
    expect(screen.getAllByRole("button", { name: "Los dit op" })).toHaveLength(3);
    expect(screen.queryByText(/sk-ant-/)).not.toBeInTheDocument();
  });

  it("‘Los dit op’ stuurt een opdracht naar de AI met bestand en regel, zonder het geheim te noemen", async () => {
    (api.runtime as Mock).mockResolvedValue(rapport);
    (api.chatSend as Mock).mockResolvedValue(undefined);
    render(<PublishPanel project={project} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Controleer veiligheid" }));
    const knoppen = await screen.findAllByRole("button", { name: "Los dit op" });
    fireEvent.click(knoppen[0]);
    await waitFor(() => expect(api.chatSend).toHaveBeenCalledWith(3, expect.stringContaining("src/api.ts, regel 3")));
    const prompt = (api.chatSend as Mock).mock.calls[0][1] as string;
    expect(prompt).toContain(".env");
    expect(prompt).toContain("vernieuwen of intrekken");
    expect(prompt).not.toMatch(/sk-ant-[A-Za-z0-9]{10}/);
    fireEvent.click(knoppen[1]);
    await waitFor(() => expect((api.chatSend as Mock).mock.calls[1][1]).toContain("row level security"));
  });

  it("meldt als alles goed is", async () => {
    (api.runtime as Mock).mockResolvedValue({ scanned: 9, findings: [] });
    render(<PublishPanel project={project} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Controleer veiligheid" }));
    expect(await screen.findByText("Alles ziet er goed uit: er zijn geen problemen gevonden in 9 bestanden.")).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import PublishPanel from "./PublishPanel";
import * as api from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const project = { id: 3, naam: "Kapsalon", pad: "/p", template: "leeg", created_at: "", default_account_id: null };

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

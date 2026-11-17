import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import VersionsDialog from "./VersionsDialog";
import * as api from "../../lib/api";

vi.mock("../../lib/api");

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const versions = [
  { hash: "c".repeat(40), short: "ccccccc", date: ago(2), message: "Bestelknop toegevoegd" },
  { hash: "b".repeat(40), short: "bbbbbbb", date: ago(30), message: "Studio: automatische back-up vóór terugzetten" },
  { hash: "a".repeat(40), short: "aaaaaaa", date: ago(300), message: "Eerste pagina gemaakt" },
];

function setup(list = versions) {
  (api.runtime as Mock).mockImplementation(async (_id: number, cmd: string) => (cmd === "git.list" ? list : { unchanged: false, safety: "s", hash: "n" }));
  const onError = vi.fn();
  render(<VersionsDialog projectId={1} onClose={vi.fn()} onError={onError} />);
  return onError;
}

describe("VersionsDialog", () => {
  it("toont een tijdlijn met titel en tijd in gewone taal; de nieuwste heeft geen terugknop", async () => {
    setup();
    const list = await screen.findByTestId("versions-list");
    expect(list).toHaveTextContent("Bestelknop toegevoegd");
    expect(list).toHaveTextContent("2 minuten geleden");
    expect(list).toHaveTextContent("huidige versie");
    expect(list).toHaveTextContent("Automatische back-up");
    expect(list).not.toHaveTextContent("Studio: automatische");
    expect(within(list).getAllByRole("button", { name: "Terug naar deze versie" })).toHaveLength(2);
  });

  it("vraagt bevestiging met uitleg dat er niets verloren gaat en zet dan veilig terug", async () => {
    setup();
    const list = await screen.findByTestId("versions-list");
    fireEvent.click(within(list).getAllByRole("button", { name: "Terug naar deze versie" })[1]);
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Eerste pagina gemaakt");
    expect(dlg).toHaveTextContent("Er gaat dus niets verloren");
    expect(api.runtime).not.toHaveBeenCalledWith(1, "git.restore", expect.anything());
    fireEvent.click(within(dlg).getByRole("button", { name: "Ja, ga terug" }));
    await waitFor(() => expect(api.runtime).toHaveBeenCalledWith(1, "git.restore", { hash: "a".repeat(40) }));
    expect(await screen.findByRole("status")).toHaveTextContent("Je vorige werk staat veilig");
  });

  it("annuleren zet niets terug", async () => {
    setup();
    const list = await screen.findByTestId("versions-list");
    fireEvent.click(within(list).getAllByRole("button", { name: "Terug naar deze versie" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Annuleren" }));
    expect(api.runtime).not.toHaveBeenCalledWith(1, "git.restore", expect.anything());
  });

  it("toont een vriendelijke lege staat en meldt fouten in gewone taal", async () => {
    setup([]);
    expect(await screen.findByTestId("versions-empty")).toHaveTextContent("Er zijn nog geen versies");
  });

  it("fouten bij terugzetten worden gemeld", async () => {
    const onError = setup();
    (api.runtime as Mock).mockImplementation(async (_i: number, cmd: string) => {
      if (cmd === "git.list") return versions;
      throw new Error("kapot");
    });
    const list = await screen.findByTestId("versions-list");
    fireEvent.click(within(list).getAllByRole("button", { name: "Terug naar deze versie" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Ja, ga terug" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

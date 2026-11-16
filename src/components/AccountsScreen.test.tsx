import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import AccountsScreen from "./AccountsScreen";
import * as api from "../lib/api";

vi.mock("../lib/api");

describe("AccountsScreen", () => {
  it("voegt een account toe met alleen provider en label", async () => {
    (api.createAccount as Mock).mockResolvedValue({});
    const changed = vi.fn();
    render(<AccountsScreen accounts={[]} onChanged={changed} onError={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Werk" } });
    fireEvent.click(screen.getByRole("button", { name: "Account toevoegen" }));
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledWith("claude", "Werk"));
    expect(changed).toHaveBeenCalled();
  });

  it("toont accounts met een Inloggen-knop en de profielmap", () => {
    render(
      <AccountsScreen
        accounts={[{ id: 1, provider: "gemini", label: "Privé", profile_dir: "/data/profiles/gemini-1", created_at: "" }]}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Inloggen" })).toBeInTheDocument();
    expect(screen.getByText("/data/profiles/gemini-1")).toBeInTheDocument();
  });
});

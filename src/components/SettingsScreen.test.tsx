import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import SettingsScreen from "./SettingsScreen";
import FormattedText from "./chat/formatText";

describe("Instellingen", () => {
  it("toont 'Eenvoudige taal' (aan) naast 'Technisch' en schakelt om", () => {
    const onC = vi.fn();
    render(<SettingsScreen communication="simple" permission="important" onCommunication={onC} onPermission={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Eenvoudige taal/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Technisch/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Technisch/ }));
    expect(onC).toHaveBeenCalledWith("technical");
    expect(screen.getByText(/CLAUDE.md, GEMINI.md en AGENTS.md/)).toBeInTheDocument();
  });

  it("toestemmingen: 'Vraag altijd' of 'Vraag alleen bij belangrijke dingen', met de zekerheid dat gevaar altijd vraagt", () => {
    const onP = vi.fn();
    render(<SettingsScreen communication="simple" permission="important" onCommunication={vi.fn()} onPermission={onP} />);
    expect(screen.getByRole("radio", { name: /Vraag alleen bij belangrijke dingen/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Vraag altijd/ }));
    expect(onP).toHaveBeenCalledWith("always");
    expect(screen.getByText(/verwijderen en publiceren, vragen altijd bevestiging/)).toBeInTheDocument();
  });
});

describe("FormattedText", () => {
  it("rendert vet, code en genummerde lijsten, en voegt nooit HTML in", () => {
    const { container } = render(<FormattedText text={'Hallo **wereld** en `code`\n\n1. een\n2. twee\n\n<script>alert(1)</script><img src=x onerror=alert(1)>'} />);
    expect(container.querySelector("strong")?.textContent).toBe("wereld");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import Workspace from "./Workspace";

describe("Workspace", () => {
  it("toont de drie tabs in het Nederlands", () => {
    render(<Workspace project={null} />);
    for (const naam of ["Terminal", "Preview", "Publiceren"]) {
      expect(screen.getByRole("tab", { name: naam })).toBeInTheDocument();
    }
  });

  it("wisselt van tab", () => {
    render(<Workspace project={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  });
});

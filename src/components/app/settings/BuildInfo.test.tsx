import { render, screen } from "@testing-library/react";
import BuildInfo from "./BuildInfo";

describe("BuildInfo", () => {
  it("toont versie, commit en bouwtijd, en dat dit de ontwikkelversie is", () => {
    render(<BuildInfo />);
    expect(screen.getByTestId("build-versie").textContent).toMatch(/^\d+\.\d+\.\d+/);
    expect(screen.getByTestId("build-commit").textContent?.length).toBeGreaterThan(3);
    expect(screen.getByTestId("build-tijd").getAttribute("data-iso")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(screen.getByText(/ontwikkelversie/)).toBeInTheDocument();
  });
});

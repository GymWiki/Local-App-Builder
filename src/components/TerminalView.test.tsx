import { render } from "@testing-library/react";
import { vi } from "vitest";

const terms: { options: { theme?: { background?: string } }; disposed: boolean }[] = [];
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { theme?: { background?: string } };
    disposed = false;
    constructor(o: { theme?: { background?: string } }) {
      this.options = { ...o };
      terms.push(this as unknown as (typeof terms)[number]);
    }
    loadAddon() {}
    open() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    dispose() {
      this.disposed = true;
    }
    focus() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@/lib/api", () => ({ ptyResize: vi.fn(), ptyWrite: vi.fn(), ptySnapshot: vi.fn().mockResolvedValue({ data: "", end_offset: 0, exited: false, exit_code: null }) }));
vi.mock("@/lib/ptyEvents", () => ({ decode: () => "", subscribe: vi.fn().mockResolvedValue(() => undefined) }));

import TerminalView from "./TerminalView";

describe("TerminalView volgt het thema", () => {
  it("geeft xterm nieuwe kleuren als <html> tussen licht en donker wisselt, en ruimt op bij sluiten", async () => {
    document.documentElement.style.setProperty("--background", "licht-bg");
    const { unmount } = render(<TerminalView sessionId="s1" active exitText={() => "klaar"} />);
    expect(terms[0].options.theme?.background).toBe("licht-bg");
    document.documentElement.style.setProperty("--background", "donker-bg");
    document.documentElement.classList.add("dark");
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver is asynchroon
    expect(terms[0].options.theme?.background).toBe("donker-bg");
    unmount();
    expect(terms[0].disposed).toBe(true);
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("--background");
  });
});

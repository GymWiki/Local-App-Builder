import { friendlyTitle, timeAgo } from "./time";

describe("tijd en titels", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("toont tijden in gewoon Nederlands", () => {
    expect(timeAgo("2026-11-17T11:59:50Z", now)).toBe("zojuist");
    expect(timeAgo("2026-11-17T11:55:00Z", now)).toBe("5 minuten geleden");
    expect(timeAgo("2026-11-17T09:00:00Z", now)).toBe("3 uur geleden");
    expect(timeAgo("2026-11-16T12:00:00Z", now)).toBe("gisteren");
    expect(timeAgo("kapot", now)).toBe("kapot");
  });
  it("maakt van git-berichten titels voor mensen", () => {
    expect(friendlyTitle("Studio: automatische back-up vóór terugzetten")).toBe("Automatische back-up");
    expect(friendlyTitle("Terug naar: Inlog toegevoegd (a1b2c3d)")).toBe("Teruggezet naar: Inlog toegevoegd");
    expect(friendlyTitle("Bestelknop toegevoegd")).toBe("Bestelknop toegevoegd");
  });
});

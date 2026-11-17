import { checkFile, extOf, pastedName } from "./files";

describe("bestanden: controle vooraf", () => {
  it("herkent extensies, ook met hoofdletters en paden", () => {
    expect(extOf("Foto.PNG")).toBe("png");
    expect(extOf("C:\\map\\a.b.pdf")).toBe("pdf");
    expect(extOf("zonder")).toBe("");
  });
  it("staat alleen afbeeldingen en documenten toe", () => {
    for (const n of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.pdf", "a.txt", "a.md", "a.csv", "a.json"]) expect(checkFile(n, 10).ok).toBe(true);
    for (const n of ["a.exe", "a.js", "a.html", "a.svg", "a.zip", "a"]) expect(checkFile(n, 10)).toEqual({ ok: false, reason: "type" });
  });
  it("beperkt de grootte per soort", () => {
    expect(checkFile("a.png", 10 * 1024 * 1024).ok).toBe(true);
    expect(checkFile("a.png", 10 * 1024 * 1024 + 1)).toEqual({ ok: false, reason: "size", max: 10 });
    expect(checkFile("a.pdf", 5 * 1024 * 1024 + 1)).toEqual({ ok: false, reason: "size", max: 5 });
  });
  it("geeft geplakte plaatjes zonder naam een duidelijke naam", () => {
    expect(pastedName(new File(["x"], "image.png", { type: "image/png" }), 7)).toBe("plaatje-7.png");
    expect(pastedName(new File(["x"], "logo.png", { type: "image/png" }), 7)).toBe("logo.png");
  });
});

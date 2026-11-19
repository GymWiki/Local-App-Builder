import { anonimiseer, isMensentaal, vertaalFout } from "./fouten";

describe("fouten in gewone taal", () => {
  it.each([
    ["No space left on device (os error 28)", "schijf_vol"],
    ["Access is denied. (os error 5)", "geen_toestemming"],
    ["EACCES: permission denied, open '/x'", "geen_toestemming"],
    ["The process cannot access the file because it is being used by another process. (os error 32)", "in_gebruik"],
    ["database is locked", "database_bezig"],
    ["operation timed out", "time_out"],
    ["getaddrinfo ENOTFOUND api.github.com", "geen_internet"],
    ["geen_internet", "geen_internet"],
    ["HTTP 401 Unauthorized", "inloggen"],
    ["File exists (os error 17)", "bestaat_al"],
    ["spawn git ENOENT", "geen_programma"],
    ["No such file or directory (os error 2)", "niet_gevonden"],
    ["iets heel geks", "onbekend"],
  ])("%s → %s", (raw, code) => expect(vertaalFout(raw).code).toBe(code));

  it("bewaart de ruwe tekst als details en kan overweg met een Error of een object", () => {
    expect(vertaalFout("os error 28").details).toBe("os error 28");
    expect(vertaalFout(new Error("EBUSY: resource busy")).code).toBe("in_gebruik");
    expect(vertaalFout({ a: 1 }).code).toBe("onbekend");
    expect(vertaalFout(undefined).code).toBe("onbekend");
  });

  it("anonimiseert paden met een gebruikersnaam", () => {
    expect(anonimiseer("C:\\Users\\Jan de Vries\\Documents\\x")).not.toContain("Jan");
    expect(anonimiseer("/home/pieter/projecten/x")).toBe("~/projecten/x");
    expect(anonimiseer("/Users/joke/Studio")).toBe("~/Studio");
  });

  it("tekst die al gewone taal is, blijft zoals hij is; technische tekst niet", () => {
    expect(isMensentaal("De map “Site” bestaat al op die locatie.")).toBe(true);
    expect(isMensentaal("Geef je project een naam.")).toBe(true);
    expect(isMensentaal("No space left on device (os error 28)")).toBe(false);
    expect(isMensentaal("Error: kon het bestand niet openen")).toBe(false);
    expect(isMensentaal("De map ligt in C:\\Users\\jan\\x en ENOENT trad op")).toBe(false);
    expect(isMensentaal("iets raars")).toBe(false);
    expect(vertaalFout("De map “Site” bestaat al op die locatie.").mensentaal).toBe(true);
    expect(vertaalFout("os error 28: No space left on device").mensentaal).toBe(false);
  });
});


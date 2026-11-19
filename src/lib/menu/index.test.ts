import { backupStatus, geenSignalen, gegevensZichtbaar, GROEPEN, MAX_ZICHTBAAR, menuStatus, stappen, verborgenItems, volgendeStap, zichtbareItems, type Signalen } from "./index";

const met = (o: Partial<Signalen>): Signalen => ({ ...geenSignalen(), ...o });

describe("voortgang: de vier stappen", () => {
  it("een nieuw project begint bij het idee", () => {
    expect(stappen(geenSignalen()).map((s) => s.klaar)).toEqual([false, false, false, false]);
    expect(volgendeStap(geenSignalen())).toBe("idee");
  });

  it("stap 1 is klaar met een eerste opdracht óf een ingevulde PROJECT.md", () => {
    expect(stappen(met({ eersteOpdracht: true }))[0].klaar).toBe(true);
    expect(stappen(met({ projectMdIngevuld: true }))[0].klaar).toBe(true);
  });

  it("stap 2 is klaar als de preview draait of er al een opgeslagen versie is", () => {
    expect(stappen(met({ previewDraait: true }))[1].klaar).toBe(true);
    expect(stappen(met({ aantalVersies: 1 }))[1].klaar).toBe(true);
    expect(stappen(met({ eersteOpdracht: true }))[1].klaar).toBe(false);
  });

  it("stap 3 is klaar met een opgeslagen versie ná de eerste", () => {
    expect(stappen(met({ aantalVersies: 1 }))[2].klaar).toBe(false);
    expect(stappen(met({ aantalVersies: 2 }))[2].klaar).toBe(true);
  });

  it("stap 4 is klaar als het project online is gezet", () => {
    expect(stappen(met({ online: true }))[3].klaar).toBe(true);
  });

  it("de volgende stap is de eerste die nog niet klaar is, en daarna 'klaar'", () => {
    expect(volgendeStap(met({ eersteOpdracht: true }))).toBe("voorbeeld");
    expect(volgendeStap(met({ eersteOpdracht: true, previewDraait: true }))).toBe("aanpassen");
    expect(volgendeStap(met({ eersteOpdracht: true, aantalVersies: 2 }))).toBe("online");
    expect(volgendeStap(met({ eersteOpdracht: true, aantalVersies: 2, online: true }))).toBe("klaar");
  });
});

describe("statusbolletjes in het menu", () => {
  it("leeg als er nog niets is", () => {
    const s = menuStatus(geenSignalen());
    for (const id of ["start", "schermen", "uiterlijk", "bestanden", "onlinezetten", "versies"] as const) expect(s[id]?.punt, id).toBe("leeg");
    expect(s.versies?.telling).toBe(0);
  });

  it("Uiterlijk is klaar als er een kit is gekozen", () => {
    expect(menuStatus(met({ kitGekozen: true })).uiterlijk?.punt).toBe("klaar");
  });

  it("Online zetten vraagt aandacht als de controles falen, ook al is het project al online", () => {
    expect(menuStatus(met({ checksFalen: true })).onlinezetten?.punt).toBe("actie");
    expect(menuStatus(met({ checksFalen: true, online: true })).onlinezetten?.punt).toBe("actie");
    expect(menuStatus(met({ online: true })).onlinezetten?.punt).toBe("klaar");
  });

  it("Eerdere versies, Foto's en Schermen tonen een aantal", () => {
    const s = menuStatus(met({ aantalVersies: 4, aantalFotos: 3, aantalSchermen: 2 }));
    expect([s.versies?.telling, s.bestanden?.telling, s.schermen?.telling]).toEqual([4, 3, 2]);
    expect([s.versies?.punt, s.bestanden?.punt, s.schermen?.punt]).toEqual(["klaar", "klaar", "klaar"]);
  });

  it("Start is klaar als alle vier de stappen klaar zijn", () => {
    expect(menuStatus(met({ eersteOpdracht: true, aantalVersies: 2, online: true })).start?.punt).toBe("klaar");
    expect(menuStatus(met({ eersteOpdracht: true, aantalVersies: 2 })).start?.punt).toBe("leeg");
  });

  it("Gegevens: aandacht als de AI opslag nodig vindt maar er nog geen database is; klaar als die er is", () => {
    expect(menuStatus(met({ needsData: true })).gegevens?.punt).toBe("actie");
    expect(menuStatus(met({ needsData: true, heeftDatabase: true })).gegevens?.punt).toBe("klaar");
    expect(menuStatus(met({ heeftDatabase: true })).gegevens?.punt).toBe("klaar");
  });
});

describe("Gegevens verschijnt pas als het nodig is", () => {
  it("niet in een nieuw project", () => {
    expect(gegevensZichtbaar(geenSignalen(), {})).toBe(false);
    const items = zichtbareItems(geenSignalen(), {}).flatMap((g) => g.items);
    expect(items).not.toContain("gegevens");
  });

  it("wel bij een database of migratiemap, bij needs_data of als de gebruiker het zelf toevoegt", () => {
    expect(gegevensZichtbaar({ heeftDatabase: true, needsData: false }, {})).toBe(true);
    expect(gegevensZichtbaar({ heeftDatabase: false, needsData: true }, {})).toBe(true);
    expect(gegevensZichtbaar({ heeftDatabase: false, needsData: false }, { gegevens_aan: "1" })).toBe(true);
    expect(gegevensZichtbaar({ heeftDatabase: false, needsData: false }, { gegevens_aan: "0" })).toBe(false);
  });

  it("'Meer onderdelen' toont wat nog verborgen is", () => {
    expect(verborgenItems(geenSignalen(), {})).toEqual(["gegevens"]);
    expect(verborgenItems(geenSignalen(), { gegevens_aan: "1" })).toEqual([]);
    expect(verborgenItems({ heeftDatabase: true, needsData: false }, {})).toEqual([]);
  });
});

describe("structuur van het menu", () => {
  it("in de standaardstand staan hoogstens acht onderdelen in de lijst", () => {
    const n = zichtbareItems(geenSignalen(), {}).flatMap((g) => g.items).length;
    expect(n).toBeLessThanOrEqual(MAX_ZICHTBAAR);
    expect(n).toBe(8);
  });

  it("de groepen zijn Maken, Delen en Beheer, in die volgorde, en geen onderdeel staat dubbel", () => {
    expect(GROEPEN.map((g) => g.id)).toEqual(["maken", "delen", "beheer"]);
    const alle = GROEPEN.flatMap((g) => g.items);
    expect(new Set(alle).size).toBe(alle.length);
    expect(zichtbareItems(geenSignalen(), {})[0].items).toEqual(["start", "schermen", "uiterlijk", "bestanden"]);
  });
});

describe("koppelingen in het menu", () => {
  const met = (k: Signalen["koppelingen"], extra: Partial<Signalen> = {}): Signalen => ({ ...geenSignalen(), koppelingen: k, ...extra });

  it("een verlopen of kapotte koppeling vraagt actie bij het onderdeel dat hem nodig heeft", () => {
    expect(menuStatus(met({ vercel: "verlopen" })).onlinezetten?.punt).toBe("actie");
    expect(menuStatus(met({ supabase: "fout" })).gegevens?.punt).toBe("actie");
    expect(menuStatus(met({ github: "verlopen" })).versies?.punt).toBe("actie");
  });

  it("een werkende of ontbrekende koppeling is geen reden voor actie; een werkende Supabase telt als gezond", () => {
    expect(menuStatus(met({ vercel: "werkt" })).onlinezetten?.punt).toBe("leeg");
    expect(menuStatus(met({})).onlinezetten?.punt).toBe("leeg");
    expect(menuStatus(met({ supabase: "werkt" })).gegevens?.punt).toBe("klaar");
    expect(menuStatus(met({ github: "niet_gekoppeld" })).versies?.punt).toBe("leeg");
    expect(menuStatus(met({ github: "bezig" }, { aantalVersies: 2 })).versies).toEqual({ punt: "klaar", telling: 2 });
  });
});

describe("backup-status (GitHub)", () => {
  const nu = 1_000_000;
  const link = (o: Partial<{ probleem: string | null; uiteengelopen: string | null; laatste: number | null }> = {}) => ({ probleem: null, uiteengelopen: null, laatste: nu - 60, ...o });
  it("niet ingesteld = geen; alles gelijk = recent; probleem of uiteengelopen = probleem", () => {
    expect(backupStatus({ link: null, nieuw: 3 }, nu)).toBe("geen");
    expect(backupStatus({ link: link(), nieuw: 0 }, nu)).toBe("recent");
    expect(backupStatus({ link: link({ probleem: "geen_internet" }), nieuw: 0 }, nu)).toBe("probleem");
    expect(backupStatus({ link: link({ uiteengelopen: "uiteengelopen" }), nieuw: 0 }, nu)).toBe("probleem");
  });
  it("nieuwe versies zonder recente back-up is een achterstand", () => {
    expect(backupStatus({ link: link({ laatste: nu - 3600 }), nieuw: 2 }, nu)).toBe("recent");
    expect(backupStatus({ link: link({ laatste: nu - 3 * 86_400 }), nieuw: 2 }, nu)).toBe("achter");
    expect(backupStatus({ link: link({ laatste: null }), nieuw: 1 }, nu)).toBe("achter");
  });
  it("bepaalt het bolletje van Eerdere versies", () => {
    const met = (o: Partial<Signalen>) => ({ ...geenSignalen(), ...o });
    expect(menuStatus(met({ aantalVersies: 3, backup: "achter" })).versies?.punt).toBe("actie");
    expect(menuStatus(met({ aantalVersies: 3, backup: "probleem" })).versies?.punt).toBe("actie");
    expect(menuStatus(met({ aantalVersies: 3, backup: "recent" })).versies?.punt).toBe("klaar");
    expect(menuStatus(met({ aantalVersies: 0, backup: "geen" })).versies?.punt).toBe("leeg");
  });
});

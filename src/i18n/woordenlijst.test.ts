import nl from "./nl.json";

type Boom = { [k: string]: string | Boom };
const platte = (o: Boom, pad: string[] = []): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[[...pad, k].join("."), v] as [string, string]] : platte(v, [...pad, k])));

describe("woordenlijst en vaktaal", () => {
  it("de vaste woorden staan centraal in de woordenlijst", () => {
    const w = nl.woordenlijst;
    expect(w.voorbeeld).toBe("Voorbeeld");
    expect(w.onlineZetten).toBe("Online zetten");
    expect(w.watJeAppOnthoudt).toBe("Wat je app onthoudt");
    expect(w.opgeslagenVersie).toBe("Opgeslagen versie");
    expect(w.terugNaarEerdereVersie).toBe("Terug naar een eerdere versie");
    expect(w.inlogsleutel).toBe("Inlogsleutel");
    expect(w.technischeWeergave).toBe("Technische weergave");
  });

  it("het menu en de werkruimte-onderdelen gebruiken die woorden", () => {
    expect(nl.werkruimte.paneel.preview).toBe(nl.woordenlijst.voorbeeld);
    expect(nl.werkruimte.paneel.onlinezetten).toBe(nl.woordenlijst.onlineZetten);
    expect(nl.werkruimte.paneel.gegevens).toBe(nl.woordenlijst.watJeAppOnthoudt);
  });

  it("in de gewone weergave staat geen vaktaal (alleen onder ‘Voor gevorderden’, logs, technische status, code of in prompts voor de AI)", () => {
    const vaktaal = /\b(preview|deploy\w*|checkpoint\w*|commit\w*|rollback|token\w*|mcp|database)\b/i;
    const uitzondering = /(^|\.)(gevorderd|logs|technisch|code|prompt|kitPrompt|hint|mcpTools)(\.|$)/i;
    const gewone = ["menu", "start", "schermen", "bestanden", "hulp", "appwinkel", "online", "inst", "mcp", "werkruimte", "tabs", "notice"];
    const fouten = platte(nl as unknown as Boom)
      .filter(([k]) => gewone.includes(k.split(".")[0]) && !uitzondering.test(k))
      .filter(([k, v]) => vaktaal.test(v) && !k.startsWith("inst.gevorderd") && !k.startsWith("menu.gevorderd"))
      .map(([k]) => k);
    expect(fouten).toEqual([]);
  });
});

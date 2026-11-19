import { bepaalRoute, geenFeiten, ROUTE_STAPPEN, type RouteFeiten } from "./route";

const met = (o: Partial<RouteFeiten>): RouteFeiten => ({ ...geenFeiten(), ...o });

describe("de route van idee tot app", () => {
  it("heeft acht stappen en een nieuw project begint bij het idee", () => {
    expect(ROUTE_STAPPEN).toHaveLength(8);
    const r = bepaalRoute(geenFeiten());
    expect(r.huidig).toBe("idee");
    expect(r.nummer).toBe(1);
    expect(r.stappen.filter((s) => s.huidig)).toHaveLength(1);
  });

  it("loopt de stappen één voor één af", () => {
    let f = met({ heeft_idee: true });
    expect(bepaalRoute(f).huidig).toBe("plan");
    f = { ...f, plan_klaar: true };
    expect(bepaalRoute(f).huidig).toBe("uiterlijk");
    f = { ...f, kit_gekozen: true };
    expect(bepaalRoute(f).huidig).toBe("bouwen");
    f = { ...f, versies: 1 };
    expect(bepaalRoute(f).huidig).toBe("aanpassen");
    f = { ...f, versies: 2 };
    expect(bepaalRoute(f).huidig).toBe("testen"); // gegevens zijn niet nodig en tellen als klaar
    f = { ...f, tests_ok: true };
    expect(bepaalRoute(f).huidig).toBe("delen");
    f = { ...f, back_up: true };
    const k = bepaalRoute(f);
    expect(k.huidig).toBe("klaar");
    expect(k.nummer).toBe(8);
  });

  it("gegevens staan alleen open als de app ze nodig heeft", () => {
    const basis = met({ heeft_idee: true, plan_klaar: true, kit_gekozen: true, versies: 2 });
    expect(bepaalRoute(basis).stappen.find((s) => s.id === "gegevens")).toMatchObject({ klaar: true, nvt: true });
    const nodig = bepaalRoute({ ...basis, gegevens_nodig: true });
    expect(nodig.huidig).toBe("gegevens");
    expect(bepaalRoute({ ...basis, gegevens_nodig: true, gegevens_klaar: true }).huidig).toBe("testen");
  });

  it("een overgeslagen stap blokkeert niets en de gebruiker kan vrij verder", () => {
    const r = bepaalRoute(met({ heeft_idee: true, overgeslagen: ["plan", "uiterlijk"] }));
    expect(r.huidig).toBe("bouwen");
    expect(r.stappen.find((s) => s.id === "plan")).toMatchObject({ overgeslagen: true, klaar: false, huidig: false });
  });

  it("een mislukte controle telt niet als klaar", () => {
    const f = met({ heeft_idee: true, plan_klaar: true, kit_gekozen: true, versies: 2, tests_ok: false });
    expect(bepaalRoute(f).huidig).toBe("testen");
  });

  it("delen is klaar bij een back-up, online of een begonnen winkelvoorbereiding", () => {
    const basis = met({ heeft_idee: true, plan_klaar: true, kit_gekozen: true, versies: 2, tests_ok: true });
    for (const k of ["back_up", "online", "winkel"] as const) expect(bepaalRoute({ ...basis, [k]: true }).huidig, k).toBe("klaar");
  });
});

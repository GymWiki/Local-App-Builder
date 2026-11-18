import { onlineStappen, volgendeOnlineStap, type OnlineSignalen } from "./online";

const basis: OnlineSignalen = { controlesGroen: false, vercelGekoppeld: false, ontbrekendeVariabelen: 0, voorbeeldOnline: false, liveOnline: false };

describe("online zetten: de vijf stappen", () => {
  it("begint bij de controles en loopt de stappen één voor één af", () => {
    expect(volgendeOnlineStap(basis)).toBe("controles");
    expect(volgendeOnlineStap({ ...basis, controlesGroen: true })).toBe("gekoppeld");
    expect(volgendeOnlineStap({ ...basis, controlesGroen: true, vercelGekoppeld: true, ontbrekendeVariabelen: 2 })).toBe("variabelen");
    expect(volgendeOnlineStap({ ...basis, controlesGroen: true, vercelGekoppeld: true })).toBe("voorbeeld");
    expect(volgendeOnlineStap({ ...basis, controlesGroen: true, vercelGekoppeld: true, voorbeeldOnline: true })).toBe("live");
    expect(volgendeOnlineStap({ controlesGroen: true, vercelGekoppeld: true, ontbrekendeVariabelen: 0, voorbeeldOnline: true, liveOnline: true })).toBe("klaar");
  });
  it("variabelen zijn pas klaar als Vercel gekoppeld is", () => {
    expect(onlineStappen(basis).find((s) => s.id === "variabelen")?.klaar).toBe(false);
    expect(onlineStappen({ ...basis, vercelGekoppeld: true }).find((s) => s.id === "variabelen")?.klaar).toBe(true);
  });
});

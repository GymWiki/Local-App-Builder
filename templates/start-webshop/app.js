// Producten en bestellingen staan hier in je browser. Wil je de bestellingen echt bewaren, laat de AI dan de database koppelen
// (in de map supabase/ staat een kant-en-klare tabel voor bestellingen).
const euro = (c) => `€ ${(c / 100).toFixed(2).replace(".", ",")}`;
const producten = [
  { id: "koffie", naam: "Koffiebonen 500 g", cent: 1195 },
  { id: "thee", naam: "Groene thee", cent: 695 },
  { id: "mok", naam: "Mok met opdruk", cent: 1250 },
  { id: "tas", naam: "Katoenen tas", cent: 895 },
];
const lees = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
let mandje = lees("mandje", {});
let bestellingen = lees("bestellingen", []);
const bewaar = () => {
  localStorage.setItem("mandje", JSON.stringify(mandje));
  localStorage.setItem("bestellingen", JSON.stringify(bestellingen));
};

function teken() {
  const p = document.getElementById("producten");
  p.innerHTML = "";
  for (const x of producten) {
    const k = document.createElement("article");
    k.className = "kaart";
    k.innerHTML = `<h3 style="margin:0 0 .25rem"></h3><p class="prijs"></p>`;
    k.querySelector("h3").textContent = x.naam;
    k.querySelector(".prijs").textContent = euro(x.cent);
    const b = document.createElement("button");
    b.textContent = "In mandje";
    b.setAttribute("aria-label", `Voeg toe aan mandje: ${x.naam}`);
    b.addEventListener("click", () => {
      mandje[x.id] = (mandje[x.id] || 0) + 1;
      bewaar();
      teken();
    });
    k.append(b);
    p.append(k);
  }
  const m = document.getElementById("mandje");
  m.innerHTML = "";
  let totaal = 0;
  for (const [id, n] of Object.entries(mandje)) {
    const x = producten.find((q) => q.id === id);
    if (!x || n < 1) continue;
    totaal += x.cent * n;
    const li = document.createElement("li");
    li.className = "kaart rij";
    const t = document.createElement("span");
    t.style.flex = "1";
    t.textContent = `${n} × ${x.naam} — ${euro(x.cent * n)}`;
    const weg = document.createElement("button");
    weg.textContent = "Eén minder";
    weg.addEventListener("click", () => {
      mandje[id] = n - 1;
      if (mandje[id] < 1) delete mandje[id];
      bewaar();
      teken();
    });
    li.append(t, weg);
    m.append(li);
  }
  document.getElementById("mandje-leeg").hidden = m.children.length > 0;
  document.getElementById("totaal").textContent = euro(totaal);
  const b = document.getElementById("bestellingen");
  b.innerHTML = "";
  for (const o of bestellingen.slice().reverse()) {
    const li = document.createElement("li");
    li.className = "kaart";
    li.textContent = `${o.naam} (${o.email}) — ${euro(o.cent)}`;
    b.append(li);
  }
}
document.getElementById("bestel").addEventListener("submit", (e) => {
  e.preventDefault();
  const cent = Object.entries(mandje).reduce((s, [id, n]) => s + (producten.find((q) => q.id === id)?.cent || 0) * n, 0);
  const melding = document.getElementById("melding");
  if (cent === 0) {
    melding.textContent = "Je mandje is leeg. Kies eerst een product.";
    return;
  }
  bestellingen.push({ naam: document.getElementById("naam").value.trim(), email: document.getElementById("email").value.trim(), cent, op: new Date().toISOString() });
  mandje = {};
  bewaar();
  melding.textContent = "Bedankt! Je bestelling is geplaatst (dit is een voorbeeld, er is niets betaald).";
  e.target.reset();
  teken();
});
teken();

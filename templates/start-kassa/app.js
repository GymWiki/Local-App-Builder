// De verkopen staan in je browser (op dit apparaat). Pas de producten hieronder aan of vraag de AI om dat te doen.
const euro = (c) => `€ ${(c / 100).toFixed(2).replace(".", ",")}`;
const producten = [
  { naam: "Koffie", cent: 280 },
  { naam: "Thee", cent: 250 },
  { naam: "Appeltaart", cent: 395 },
  { naam: "Broodje kaas", cent: 450 },
];
let bon = [];
let verkopen;
try {
  verkopen = JSON.parse(localStorage.getItem("verkopen")) ?? [];
} catch {
  verkopen = [];
}
const som = () => bon.reduce((s, x) => s + x.cent, 0);
function teken() {
  document.getElementById("totaal").textContent = euro(som());
  const lijst = document.getElementById("bon");
  lijst.innerHTML = "";
  bon.forEach((x, i) => {
    const li = document.createElement("li");
    li.className = "kaart rij";
    const t = document.createElement("span");
    t.style.flex = "1";
    t.textContent = `${x.naam} — ${euro(x.cent)}`;
    const weg = document.createElement("button");
    weg.textContent = "Weg";
    weg.setAttribute("aria-label", `Haal ${x.naam} van de bon`);
    weg.addEventListener("click", () => {
      bon.splice(i, 1);
      teken();
    });
    li.append(t, weg);
    lijst.append(li);
  });
  const vandaag = new Date().toDateString();
  const dag = verkopen.filter((v) => new Date(v.op).toDateString() === vandaag);
  document.getElementById("vandaag").textContent = dag.length ? `${dag.length} verkopen, samen ${euro(dag.reduce((s, v) => s + v.cent, 0))}` : "Nog niets verkocht vandaag.";
}
const knoppen = document.getElementById("knoppen");
for (const p of producten) {
  const b = document.createElement("button");
  b.innerHTML = "<strong></strong><span></span>";
  b.querySelector("strong").textContent = p.naam;
  b.querySelector("span").textContent = euro(p.cent);
  b.addEventListener("click", () => {
    bon.push(p);
    teken();
  });
  knoppen.append(b);
}
document.getElementById("wis").addEventListener("click", () => {
  bon = [];
  teken();
});
document.getElementById("betaal").addEventListener("click", () => {
  if (!bon.length) return;
  verkopen.push({ cent: som(), regels: bon.length, op: new Date().toISOString() });
  localStorage.setItem("verkopen", JSON.stringify(verkopen));
  bon = [];
  teken();
});
teken();

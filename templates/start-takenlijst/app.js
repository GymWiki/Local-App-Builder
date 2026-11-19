// De taken worden bewaard in je browser (op deze computer). Er is geen account of internet nodig.
const SLEUTEL = "taken";
const voorbeeld = [
  { id: 1, tekst: "Mijn eerste taak afvinken", klaar: false },
  { id: 2, tekst: "Een nieuwe taak toevoegen", klaar: false },
  { id: 3, tekst: "Dit voorbeeld aanpassen met de AI", klaar: false },
];
let taken = lees();

function lees() {
  try {
    const t = JSON.parse(localStorage.getItem(SLEUTEL));
    return Array.isArray(t) ? t : voorbeeld;
  } catch {
    return voorbeeld;
  }
}
function bewaar() {
  localStorage.setItem(SLEUTEL, JSON.stringify(taken));
}
function teken() {
  const lijst = document.getElementById("lijst");
  lijst.innerHTML = "";
  for (const t of taken) {
    const li = document.createElement("li");
    li.className = "kaart rij";
    const vink = document.createElement("input");
    vink.type = "checkbox";
    vink.checked = t.klaar;
    vink.style.width = "1.5rem";
    vink.setAttribute("aria-label", `Klaar: ${t.tekst}`);
    vink.addEventListener("change", () => {
      t.klaar = vink.checked;
      bewaar();
      teken();
    });
    const naam = document.createElement("span");
    naam.textContent = t.tekst;
    naam.style.flex = "1";
    if (t.klaar) naam.className = "klaar";
    const weg = document.createElement("button");
    weg.textContent = "Verwijderen";
    weg.setAttribute("aria-label", `Verwijder: ${t.tekst}`);
    weg.addEventListener("click", () => {
      taken = taken.filter((x) => x.id !== t.id);
      bewaar();
      teken();
    });
    li.append(vink, naam, weg);
    lijst.append(li);
  }
  const open = taken.filter((t) => !t.klaar).length;
  document.getElementById("telling").textContent = taken.length ? `${open} van ${taken.length} taken nog te doen` : "";
  document.getElementById("leeg").hidden = taken.length > 0;
}
document.getElementById("nieuw").addEventListener("submit", (e) => {
  e.preventDefault();
  const veld = document.getElementById("tekst");
  const tekst = veld.value.trim();
  if (!tekst) return;
  taken.push({ id: Date.now(), tekst, klaar: false });
  veld.value = "";
  bewaar();
  teken();
});
teken();

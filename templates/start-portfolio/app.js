// Voorbeeldwerk: pas dit lijstje aan, of vraag de AI om je eigen werk toe te voegen.
const werk = [
  { titel: "Website voor een bakkerij", tekst: "Een rustige site met openingstijden en een overzicht van het brood." },
  { titel: "Fotoserie: de haven", tekst: "Twaalf foto’s van de haven in de ochtend." },
  { titel: "Logo voor een fietsenmaker", tekst: "Een eenvoudig, goed leesbaar logo." },
];
const lijst = document.getElementById("werk");
for (const w of werk) {
  const kaart = document.createElement("article");
  kaart.className = "kaart";
  const h = document.createElement("h3");
  h.textContent = w.titel;
  const p = document.createElement("p");
  p.textContent = w.tekst;
  kaart.append(h, p);
  lijst.append(kaart);
}
// Het formulier verstuurt niets: het opent het e-mailprogramma van de bezoeker. Zet hier je eigen e-mailadres.
const MIJN_EMAIL = "jouw-adres@voorbeeld.nl";
document.getElementById("formulier").addEventListener("submit", (e) => {
  e.preventDefault();
  const naam = document.getElementById("naam").value.trim();
  const bericht = document.getElementById("bericht").value.trim();
  location.href = `mailto:${MIJN_EMAIL}?subject=${encodeURIComponent("Bericht van " + naam)}&body=${encodeURIComponent(bericht)}`;
  document.getElementById("melding").textContent = "Je e-mailprogramma wordt geopend.";
});

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import nl from "./nl.json";

// Nieuwe taal toevoegen: maak `xx.json` met dezelfde sleutels en voeg hem hier toe.
void i18n.use(initReactI18next).init({
  resources: { nl: { translation: nl } },
  lng: "nl",
  fallbackLng: "nl",
  interpolation: { escapeValue: false },
});

export default i18n;

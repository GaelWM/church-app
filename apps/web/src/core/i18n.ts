import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// French first; add en/ln resources here without touching screens.
i18n.use(initReactI18next).init({
  lng: "fr", fallbackLng: "fr", interpolation: { escapeValue: false },
  resources: {
    fr: {
      translation: {
        nav: { dashboard: "Tableau de bord", recettes: "Recettes", depenses: "Dépenses", banques: "Banques", journal: "Journal", engagements: "Engagements", effectifs: "Effectifs", validation: "À valider", configuration: "Configuration" },
        common: { save: "Enregistrer", cancel: "Annuler", submit: "Soumettre", delete: "Supprimer", edit: "Modifier", loading: "Chargement…", none: "Aucun élément", provisional: "provisoire" },
        status: { brouillon: "Brouillon", soumise: "Soumise", validee1: "Validée 1 (Trésorier)", validee: "Validée", rejetee: "Rejetée" },
        role: { administrateur: "Administrateur", caissier: "Caissier", tresorier: "Trésorier", pasteur: "Pasteur" },
      },
    },
  },
});
export default i18n;

/** Page titles and tab labels: one source for the navigation, the breadcrumbs and the page tabs. */
export const PAGE_TITLES: Record<string, string> = {
  "/": "Tableau de bord",
  "/recettes": "Recettes",
  "/depenses": "Dépenses",
  "/banques": "Banques",
  "/journal": "Journal",
  "/engagements": "Engagements",
  "/effectifs": "Effectifs",
  "/validation": "À valider",
  "/configuration": "Configuration",
};

export const TAB_LABELS: Record<string, Record<string, string>> = {
  "/banques": { operations: "Opérations", rapprochement: "Rapprochement bancaire", periodes: "Clôture mensuelle" },
  "/configuration": { users: "Utilisateurs", parishes: "Paroisses", accounts: "Comptes", categories: "Catégories", rate: "Taux de change", audit: "Journal d'audit" },
};

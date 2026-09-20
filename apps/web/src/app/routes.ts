import { ArrowLeftRight, CalendarCheck, Building2, Scale, ScrollText, Tags, Users, Wallet, SlidersHorizontal, type LucideIcon } from "lucide-react";

/** Page titles and tab labels: one source for the navigation, the breadcrumbs and the page tabs. */
export const PAGE_TITLES: Record<string, string> = {
  "/": "Tableau de bord",
  "/recettes": "Recettes",
  "/depenses": "Dépenses",
  "/banques": "Banques",
  "/journal": "Journal",
  "/engagements": "Engagements",
  "/effectifs": "Effectifs",
  "/dedicaces": "Dédicace enfants",
  "/baptemes": "Baptême",
  "/mariages": "Mariage",
  "/rapports": "Rapports",
  "/validation": "À valider",
  "/configuration": "Configuration",
};

export const TAB_LABELS: Record<string, Record<string, string>> = {
  "/banques": { operations: "Opérations", rapprochement: "Rapprochement bancaire", periodes: "Clôture mensuelle" },
  "/configuration": { users: "Utilisateurs", parishes: "Paroisses", accounts: "Comptes", categories: "Catégories", rate: "Taux de change", settings: "Paramètres", audit: "Journal d'audit" },
};

export const TAB_ICONS: Record<string, Record<string, LucideIcon>> = {
  "/banques": { operations: ArrowLeftRight, rapprochement: Scale, periodes: CalendarCheck },
  "/configuration": { users: Users, parishes: Building2, accounts: Wallet, categories: Tags, rate: ArrowLeftRight, settings: SlidersHorizontal, audit: ScrollText },
};

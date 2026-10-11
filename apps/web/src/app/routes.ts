import { ArrowLeftRight, Boxes, Building2, CalendarCheck, ClipboardCheck, FileBarChart, FileClock, LineChart, PiggyBank, Receipt, Scale, ScrollText, Tags, Users, Wallet, SlidersHorizontal, type LucideIcon } from "lucide-react";

/** Page titles and tab labels: one source for the navigation, the breadcrumbs and the page tabs. */
export const PAGE_TITLES: Record<string, string> = {
  "/": "Tableau de bord",
  "/recettes": "Recettes",
  "/depenses": "Dépenses",
  "/banques": "Banques",
  "/journal": "Journal",
  "/engagements": "Engagements",
  "/budget": "Budget",
  "/immobilisations": "Immobilisations",
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
  "/budget": { depenses: "Budget des dépenses", investissements: "Budget d'investissement", suivi: "Suivi & Écarts" },
  "/immobilisations": { registre: "Registre", demandes: "Demandes", inventaire: "Inventaire", rapports: "Rapports" },
  "/configuration": { users: "Utilisateurs", parishes: "Paroisses", accounts: "Comptes", categories: "Catégories", rate: "Taux de change", settings: "Paramètres", audit: "Journal d'audit", immobilisations: "Immobilisations" },
};

/** Label of the last breadcrumb on a detail page (/immobilisations/:id). */
export const DETAIL_LABELS: Record<string, string> = { "/immobilisations": "Fiche" };

export const TAB_ICONS: Record<string, Record<string, LucideIcon>> = {
  "/banques": { operations: ArrowLeftRight, rapprochement: Scale, periodes: CalendarCheck },
  "/budget": { depenses: Receipt, investissements: PiggyBank, suivi: LineChart },
  "/immobilisations": { registre: Boxes, demandes: FileClock, inventaire: ClipboardCheck, rapports: FileBarChart },
  "/configuration": { users: Users, parishes: Building2, accounts: Wallet, categories: Tags, rate: ArrowLeftRight, settings: SlidersHorizontal, audit: ScrollText, immobilisations: Boxes },
};

export const ROLES = ["administrateur", "caissier", "tresorier", "pasteur", "auditeur"] as const;
export type Role = (typeof ROLES)[number];

export const CURRENCIES = ["CDF", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ACCOUNT_TYPES = ["caisse", "banque", "mobile_money"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TX_STATUSES = ["brouillon", "soumise", "validee1", "validee", "rejetee", "annulee"] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export const TX_KINDS = ["recette", "depense", "transfert", "change"] as const;
export type TxKind = (typeof TX_KINDS)[number];

export const DIRECTIONS = ["in", "out"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CATEGORY_KINDS = ["recette", "depense", "banque"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const ROLE_LABELS: Record<Role, string> = {
  administrateur: "Administrateur",
  caissier: "Caissier",
  tresorier: "Trésorier",
  pasteur: "Pasteur",
  auditeur: "Auditeur",
};

export const STATUS_LABELS: Record<TxStatus, string> = {
  brouillon: "Brouillon",
  soumise: "Soumise",
  validee1: "Validée 1 (Trésorier)",
  validee: "Validée",
  rejetee: "Rejetée",
  annulee: "Annulée",
};

export const ENGAGEMENT_TYPES = ["construction", "partenariat", "parcelle", "autre"] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export const ENGAGEMENT_TYPE_LABELS: Record<EngagementType, string> = {
  construction: "Construction", partenariat: "Partenariat", parcelle: "Achat parcelle", autre: "Autres engagements",
};

export const CULTE_TYPES = [
  "1er culte", "2e culte", "Écodim", "Culte d'enseignement", "Culte Maternité des Solutions",
  "Culte jeunesse", "Culte grand jeune", "Réunion des femmes", "13–17 ans", "Autre réunion",
] as const;
export type CulteType = (typeof CULTE_TYPES)[number];

export const WORKER_CATEGORIES = ["pasteur", "chef_departement", "ouvrier"] as const;
export type WorkerCategory = (typeof WORKER_CATEGORIES)[number];
export const WORKER_CATEGORY_LABELS: Record<WorkerCategory, string> = {
  pasteur: "Pasteur", chef_departement: "Chef de département", ouvrier: "Ouvrier",
};

export const CHANGE_REQUEST_KINDS = ["modification", "annulation"] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];
export const CHANGE_REQUEST_STATUSES = ["en_attente_tresorier", "approuvee_n1", "approuvee_n2", "rejetee", "executee"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  en_attente_tresorier: "En attente Trésorier", approuvee_n1: "Approuvée N1 (attente Pasteur)",
  approuvee_n2: "Approuvée N2", rejetee: "Rejetée", executee: "Exécutée",
};

export const RECORD_TYPES = ["dedication", "baptism", "marriage"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

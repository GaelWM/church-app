export const ROLES = ["administrateur", "caissier", "tresorier", "pasteur"] as const;
export type Role = (typeof ROLES)[number];

export const CURRENCIES = ["CDF", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ACCOUNT_TYPES = ["caisse", "banque", "mobile_money"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TX_STATUSES = ["brouillon", "soumise", "validee1", "validee", "rejetee"] as const;
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
};

export const STATUS_LABELS: Record<TxStatus, string> = {
  brouillon: "Brouillon",
  soumise: "Soumise",
  validee1: "Validée 1 (Trésorier)",
  validee: "Validée",
  rejetee: "Rejetée",
};

export const ROLES = ["administrateur", "caissier", "tresorier", "pasteur", "auditeur", "evangelisation"] as const;
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
  evangelisation: "Évangélisation",
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

export const BUDGET_PERIODS = ["annuel", "trimestriel", "mensuel"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];
export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  annuel: "Annuel", trimestriel: "Trimestriel", mensuel: "Mensuel",
};

export const INVESTMENT_TYPES = ["construction", "achat_parcelle", "materiel_mobilier", "vehicule", "sono", "autre"] as const;
export type InvestmentType = (typeof INVESTMENT_TYPES)[number];
export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  construction: "Construction", achat_parcelle: "Achat parcelle", materiel_mobilier: "Matériel & Mobilier",
  vehicule: "Véhicule", sono: "Sono", autre: "Autre",
};

export const ASSET_TYPES = ["mobilier", "materiel", "batiment", "terrain", "vehicule", "autre"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  mobilier: "Mobilier", materiel: "Matériel", batiment: "Bâtiment", terrain: "Terrain", vehicule: "Véhicule", autre: "Autre",
};

export const DEPRECIATION_METHODS = ["lineaire", "degressif", "non_amortissable"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];
export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  lineaire: "Linéaire", degressif: "Dégressif", non_amortissable: "Non amortissable",
};

// ---- Immobilisations (spec Compta CEPD MBUDI) ----------------------------------------------------

/** Assets may be recorded in EUR; the ledger-wide CURRENCIES stay CDF/USD. */
export const ASSET_CURRENCIES = ["USD", "CDF", "EUR"] as const;
export type AssetCurrency = (typeof ASSET_CURRENCIES)[number];
export const ASSET_CURRENCY_LABELS: Record<AssetCurrency, string> = {
  USD: "USD — Dollar américain", CDF: "CDF — Franc congolais", EUR: "EUR — Euro",
};

/** Statut = administrative/accounting situation (distinct from the physical état). */
export const ASSET_STATUTS = [
  "brouillon", "en_attente_validation", "actif", "en_amortissement", "entierement_amorti",
  "cede", "mis_au_rebut", "transfere", "annule",
] as const;
export type AssetStatut = (typeof ASSET_STATUTS)[number];
/** The two amortisation statuts are derived from the depreciation state (see displayStatut), never stored. */
export const PERSISTED_ASSET_STATUTS = [
  "brouillon", "en_attente_validation", "actif", "cede", "mis_au_rebut", "transfere", "annule",
] as const;
export type PersistedAssetStatut = (typeof PERSISTED_ASSET_STATUTS)[number];
export const ASSET_STATUT_LABELS: Record<AssetStatut, string> = {
  brouillon: "Brouillon", en_attente_validation: "En attente de validation", actif: "Actif",
  en_amortissement: "En cours d'amortissement", entierement_amorti: "Entièrement amorti",
  cede: "Cédé", mis_au_rebut: "Mis au rebut", transfere: "Transféré", annule: "Annulé",
};

/** État = physical condition of the asset. */
export const ASSET_ETATS = ["bon", "mauvais", "declasse", "perdu"] as const;
export type AssetEtat = (typeof ASSET_ETATS)[number];
export const ASSET_ETAT_LABELS: Record<AssetEtat, string> = {
  bon: "Bon", mauvais: "Mauvais", declasse: "Déclassé", perdu: "Perdu",
};
/** Changes to/from these états go through the Trésorier → Pasteur approval circuit. */
export const SENSITIVE_ETATS: readonly AssetEtat[] = ["declasse", "perdu"];
/** A new état in this list needs a written justification (observation) on top of the motif. */
export const ETATS_REQUIRING_OBSERVATION: readonly AssetEtat[] = ["mauvais", "declasse", "perdu"];

export const ASSET_REQUEST_KINDS = ["creation", "modification", "annulation", "changement_etat"] as const;
export type AssetRequestKind = (typeof ASSET_REQUEST_KINDS)[number];
export const ASSET_REQUEST_KIND_LABELS: Record<AssetRequestKind, string> = {
  creation: "Validation de l'immobilisation", modification: "Modification", annulation: "Annulation", changement_etat: "Changement d'état",
};
/** French names of the fields a modification request may change (see ASSET_MODIFIABLE_FIELDS). */
export const ASSET_FIELD_LABELS: Record<string, string> = {
  description: "Description", invoiceNumber: "N° de facture", supplierId: "Fournisseur", acquisitionDate: "Date d'acquisition",
  inServiceDate: "Date de mise en service", locationId: "Localisation", currency: "Devise", fxRatePerUsd: "Taux de change",
  fxRateDate: "Date du taux", paMinor: "Prix d'achat (PA)", faaMinor: "Frais accessoires (FAA)", method: "Mode d'amortissement",
  usefulLifeYears: "Durée d'amortissement", observations: "Observations", accountCode: "Compte", subaccountCode: "Sous-compte",
  code: "Code immobilisation", newEtat: "Nouvel état", observation: "Justification", etat: "État",
};

/** Spec labels for the shared change-request statuses (approuvee_n2 is transient inside one transaction). */
export const ASSET_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  en_attente_tresorier: "En attente", approuvee_n1: "Approuvé par le Trésorier",
  approuvee_n2: "Approuvé par les deux", executee: "Approuvé par les deux", rejetee: "Refusé",
};

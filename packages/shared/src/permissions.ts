import { ROLES, type Role } from "./enums";

export const PERMISSIONS = [
  "config.manage", // parishes, categories, accounts, departments, periods (open)
  "user.manage",
  "fx.set",
  "transaction.create", // enter + edit/delete own drafts, submit
  "transaction.validate1",
  "transaction.validate2",
  "transaction.readAll", // all menus, journal, dashboard for the parish
  "transaction.readOwn",
  "report.export",
  "audit.view",
  "period.close",
  "reconcile",
  "registry.write", // dédicaces, baptêmes, mariages, membres, nouveaux venus, ouvriers
  "registry.validate1", // 1re validation des effectifs des cultes, baptêmes et mariages (Pasteur assistant)
  "registry.validate2", // validation finale des effectifs des cultes, baptêmes et mariages (Pasteur titulaire)
  "change.request", // demander une modification / annulation
  "budget.manage", // lignes de budget des dépenses et projets d'investissement
  "asset.manage", // registre des immobilisations
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Single source of truth: read by API middleware (enforcement) and React (UI hiding).
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  administrateur: [
    "config.manage",
    "user.manage",
    "fx.set",
    "transaction.readAll",
    "report.export",
    "audit.view",
    "registry.write",
    "asset.manage",
  ],
  caissier: ["transaction.create", "transaction.readOwn", "change.request", "registry.write"],
  tresorier: ["transaction.validate1", "transaction.readAll", "report.export", "reconcile", "budget.manage", "asset.manage"],
  pasteur: [
    "transaction.validate2",
    "transaction.readAll",
    "report.export",
    "audit.view",
    "period.close",
    "registry.write",
    "registry.validate2",
    "budget.manage",
    "asset.manage",
  ],
  // Effectifs, baptême, mariage: saisie et 1re validation. Aucun accès financier, donc aucun solde de compte.
  pasteur_assistant: ["registry.write", "registry.validate1"],
  // Consultation générale uniquement: no entry, no validation.
  auditeur: ["transaction.readAll", "report.export", "audit.view"],
  // Effectifs, dédicace, baptême, mariage uniquement: aucun accès financier (saisie, banque, journal, engagements, compta).
  evangelisation: ["registry.write"],
};

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}

/** Roles that may see financial data, hence account balances (e.g. the low-balance alert emails). */
export const isFinanceRole = (r: Role) => can([r], "transaction.readAll") || can([r], "transaction.readOwn");
export const FINANCE_ROLES: readonly Role[] = ROLES.filter(isFinanceRole);

/** Roles one person may not hold together in the same parish (separation of duties). */
export const CONFLICTING_ROLE_PAIRS: ReadonlyArray<readonly [Role, Role]> = [
  ["tresorier", "caissier"],
  ["pasteur", "caissier"],
  ["administrateur", "caissier"],
  ["administrateur", "tresorier"],
  ["administrateur", "pasteur"],
  ["auditeur", "caissier"],
  ["auditeur", "tresorier"],
  ["auditeur", "pasteur"],
  ["auditeur", "administrateur"],
  ["pasteur_assistant", "pasteur"],
  ["pasteur_assistant", "caissier"],
  ["pasteur_assistant", "administrateur"],
  ["pasteur_assistant", "auditeur"],
];

export function findRoleConflict(roles: readonly Role[]): readonly [Role, Role] | null {
  for (const pair of CONFLICTING_ROLE_PAIRS) {
    if (roles.includes(pair[0]) && roles.includes(pair[1])) return pair;
  }
  return null;
}

import type { Role } from "./enums";

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
  "registry.write", // dédicaces, baptêmes, mariages, membres, ouvriers
  "change.request", // demander une modification / annulation
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
  ],
  caissier: ["transaction.create", "transaction.readOwn", "change.request", "registry.write"],
  tresorier: ["transaction.validate1", "transaction.readAll", "report.export", "reconcile"],
  pasteur: [
    "transaction.validate2",
    "transaction.readAll",
    "report.export",
    "audit.view",
    "period.close",
    "registry.write",
  ],
  // Consultation générale uniquement: no entry, no validation.
  auditeur: ["transaction.readAll", "report.export", "audit.view"],
};

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}

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
];

export function findRoleConflict(roles: readonly Role[]): readonly [Role, Role] | null {
  for (const pair of CONFLICTING_ROLE_PAIRS) {
    if (roles.includes(pair[0]) && roles.includes(pair[1])) return pair;
  }
  return null;
}

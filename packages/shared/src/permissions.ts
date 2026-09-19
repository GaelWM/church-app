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
  ],
  caissier: ["transaction.create", "transaction.readOwn"],
  tresorier: ["transaction.validate1", "transaction.readAll", "report.export", "reconcile"],
  pasteur: [
    "transaction.validate2",
    "transaction.readAll",
    "report.export",
    "audit.view",
    "period.close",
  ],
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
];

export function findRoleConflict(roles: readonly Role[]): readonly [Role, Role] | null {
  for (const pair of CONFLICTING_ROLE_PAIRS) {
    if (roles.includes(pair[0]) && roles.includes(pair[1])) return pair;
  }
  return null;
}

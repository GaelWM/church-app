import type { Db } from "@church/db";
import { ROLE_PERMISSIONS, ROLES, type Role } from "@church/shared";
import * as repo from "./me.repo";

export type Membership = { parishId: string; role: Role; consolidatedAccess: boolean };

export async function getProfile(db: Db, user: unknown, ms: Membership[]) {
  const ps = await repo.listParishesByIds(db, ms.map((m) => m.parishId).concat("00000000-0000-0000-0000-000000000000"));
  return {
    user,
    parishes: ps.map((p) => ({ ...p, roles: ms.filter((m) => m.parishId === p.id).map((m) => m.role), consolidatedAccess: ms.some((m) => m.parishId === p.id && m.consolidatedAccess) })),
    permissions: Object.fromEntries(ROLES.map((r) => [r, ROLE_PERMISSIONS[r]])),
  };
}

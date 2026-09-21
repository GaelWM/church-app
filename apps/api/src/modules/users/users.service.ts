import { HTTPException } from "hono/http-exception";
import type { Db } from "@church/db";
import { findRoleConflict, type Role } from "@church/shared";
import type { Bindings } from "../../env";
import { audit } from "../../services/audit";
import { createAuth0User, setAuth0Blocked } from "../../services/auth0";
import type { UserCreateInput } from "./users.dto";
import * as repo from "./users.repo";

type RoleInput = Array<{ parishId: string; role: Role; consolidatedAccess: boolean }>;

export function assertRoles(roles: Array<{ parishId: string; role: Role }>, adminOf: string[]) {
  const byParish = new Map<string, Role[]>();
  for (const r of roles) {
    if (!adminOf.includes(r.parishId)) throw new HTTPException(403, { message: "Paroisse non administrée" });
    byParish.set(r.parishId, [...(byParish.get(r.parishId) ?? []), r.role]);
  }
  for (const rs of byParish.values()) {
    const conflict = findRoleConflict(rs);
    if (conflict) throw new HTTPException(422, { message: `Profils incompatibles dans une même paroisse: ${conflict.join(" + ")}` });
  }
}

export async function listUsers(db: Db, mine: string[]) {
  const rows = await repo.listWithRoles(db, mine);
  const byUser = new Map<string, any>();
  for (const r of rows) {
    const u = byUser.get(r.user.id) ?? { ...r.user, roles: [] };
    u.roles.push({ parishId: r.role.parishId, role: r.role.role, consolidatedAccess: r.role.consolidatedAccess });
    byUser.set(r.user.id, u);
  }
  return [...byUser.values()];
}

/** Creates the Auth0 user, then the local user and its roles. Returns the user and its Auth0 id. */
export async function createUser(db: Db, env: Bindings, actorId: string, mine: string[], b: UserCreateInput) {
  assertRoles(b.roles, mine);
  const auth0Id = await createAuth0User(env, b.email, b.fullName);
  const u = await repo.insertUser(db, { auth0Id, email: b.email, fullName: b.fullName });
  await repo.insertRoles(db, u!.id, b.roles);
  await db.transaction((tx) => audit(tx, { actorId, action: "user.create", entity: "user", entityId: u!.id, after: { ...u, roles: b.roles } }));
  return { user: u, auth0Id };
}

export async function replaceRoles(db: Db, actorId: string, mine: string[], id: string, roles: RoleInput) {
  assertRoles(roles, mine);
  // Replace only the assignments in parishes the caller administers.
  await db.transaction(async (tx) => {
    const before = await repo.listRolesIn(tx, id, mine);
    await repo.deleteRolesIn(tx, id, mine);
    await repo.insertRoles(tx, id, roles);
    await audit(tx, { actorId, action: "user.roles", entity: "user", entityId: id, before, after: roles });
  });
}

export async function setUserActive(db: Db, env: Bindings, actorId: string, id: string, active: boolean) {
  if (id === actorId && !active) throw new HTTPException(422, { message: "Vous ne pouvez pas vous désactiver" });
  const u = await repo.setActive(db, id, active);
  if (!u) throw new HTTPException(404);
  await setAuth0Blocked(env, u.auth0Id, !active); // block in Auth0 and in users at once
  await db.transaction((tx) => audit(tx, { actorId, action: active ? "user.activate" : "user.deactivate", entity: "user", entityId: id }));
  return u;
}

export const listAdminEmails = (db: Db) => repo.listAdminEmails(db);

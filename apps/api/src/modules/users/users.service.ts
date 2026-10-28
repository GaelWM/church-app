import { HTTPException } from "hono/http-exception";
import type { Db } from "@church/db";
import { findRoleConflict, type Role } from "@church/shared";
import type { Bindings } from "../../env";
import { audit } from "../../services/audit";
import { createAuth0User, deleteAuth0User, setAuth0Blocked, updateAuth0User } from "../../services/auth0";
import type { UserCreateInput, UserUpdateInput } from "./users.dto";
import * as repo from "./users.repo";

type RoleInput = Array<{ parishId: string; role: Role; consolidatedAccess: boolean }>;

export function assertRoles(roles: Array<{ parishId: string; role: Role }>, adminOf: string[]) {
  const byParish = new Map<string, Role[]>();
  for (const r of roles) {
    if (!adminOf.includes(r.parishId)) throw new HTTPException(403, { message: "Paroisse non administrée" });
    const rs = byParish.get(r.parishId) ?? [];
    if (rs.includes(r.role)) throw new HTTPException(422, { message: "Profil en double dans une même paroisse" });
    byParish.set(r.parishId, [...rs, r.role]);
  }
  for (const rs of byParish.values()) {
    const conflict = findRoleConflict(rs);
    if (conflict) throw new HTTPException(422, { message: `Profils incompatibles dans une même paroisse: ${conflict.join(" + ")}` });
  }
}

async function assertEmailFree(db: Db, email: string, exceptId?: string) {
  const u = await repo.findByEmail(db, email);
  if (u && u.id !== exceptId) throw new HTTPException(409, { message: "Un utilisateur utilise déjà cet email" });
}

/** The target must hold a profile in a parish the caller administers: other parishes' users are not theirs to see. */
async function managedUser(db: Db, id: string, mine: string[]) {
  const user = await repo.findById(db, id);
  const roles = user ? await repo.listRoles(db, id) : [];
  if (!user || !roles.some((r) => mine.includes(r.parishId))) throw new HTTPException(404, { message: "Utilisateur introuvable" });
  return { user, roles };
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
  await assertEmailFree(db, b.email);
  const auth0Id = await createAuth0User(env, b.email, b.fullName);
  const u = await repo.insertUser(db, { auth0Id, email: b.email, fullName: b.fullName });
  await repo.insertRoles(db, u!.id, b.roles);
  await db.transaction((tx) => audit(tx, { actorId, action: "user.create", entity: "user", entityId: u!.id, after: { ...u, roles: b.roles } }));
  return { user: u, auth0Id };
}

/** Name and email, locally and in Auth0. Returns the user before and after (the same object when nothing changed). */
export async function updateUser(db: Db, env: Bindings, actorId: string, mine: string[], id: string, b: UserUpdateInput) {
  const { user: before } = await managedUser(db, id, mine);
  const changes: UserUpdateInput = {};
  if (b.fullName !== undefined && b.fullName !== before.fullName) changes.fullName = b.fullName;
  if (b.email !== undefined && b.email !== before.email) changes.email = b.email;
  if (!Object.keys(changes).length) return { before, after: before };
  if (changes.email) await assertEmailFree(db, changes.email, id);
  const after = await db.transaction(async (tx) => {
    const u = await repo.updateUser(tx, id, changes);
    await audit(tx, { actorId, action: "user.update", entity: "user", entityId: id, before: { email: before.email, fullName: before.fullName }, after: { email: u!.email, fullName: u!.fullName } });
    // Last, so that an Auth0 failure rolls the local change back.
    await updateAuth0User(env, before.auth0Id, changes);
    return u!;
  });
  return { before, after };
}

export async function replaceRoles(db: Db, actorId: string, mine: string[], id: string, roles: RoleInput) {
  assertRoles(roles, mine);
  // Replace only the assignments in parishes the caller administers.
  await db.transaction(async (tx) => {
    const before = await repo.listRolesIn(tx, id, mine);
    if (id === actorId && before.some((r) => r.role === "administrateur" && !roles.some((n) => n.parishId === r.parishId && n.role === "administrateur")))
      throw new HTTPException(422, { message: "Vous ne pouvez pas retirer votre propre profil Administrateur" });
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

/**
 * Only for an account that never acted (e.g. invited by mistake): entries, validations, records and the audit log keep
 * their author, so a user with history is deactivated instead.
 */
export async function deleteUser(db: Db, env: Bindings, actorId: string, mine: string[], id: string) {
  if (id === actorId) throw new HTTPException(422, { message: "Vous ne pouvez pas supprimer votre propre compte" });
  const { user, roles } = await managedUser(db, id, mine);
  if (roles.some((r) => !mine.includes(r.parishId))) throw new HTTPException(403, { message: "Utilisateur rattaché à une paroisse que vous n'administrez pas" });
  const hasHistory = new HTTPException(409, { message: "Cet utilisateur a déjà un historique : désactivez-le plutôt" });
  if (await repo.hasAuditActions(db, id)) throw hasHistory;
  try {
    await db.transaction(async (tx) => {
      await repo.deleteUser(tx, id);
      await audit(tx, { actorId, action: "user.delete", entity: "user", entityId: id, before: { ...user, roles } });
      // Last, so that an Auth0 failure rolls the local deletion back.
      await deleteAuth0User(env, user.auth0Id);
    });
  } catch (e) {
    if ((e as any)?.code === "23503") throw hasHistory; // still referenced (entry, validation, record…)
    throw e;
  }
  return user;
}

export const listAdminEmails = (db: Db) => repo.listAdminEmails(db);

import { and, eq, inArray } from "drizzle-orm";
import { userParishRoles, users, type Db, type Tx } from "@church/db";

export const listWithRoles = (db: Db, parishIds: string[]) =>
  db.select({ user: users, role: userParishRoles }).from(users)
    .innerJoin(userParishRoles, eq(userParishRoles.userId, users.id)).where(inArray(userParishRoles.parishId, parishIds));

export async function insertUser(db: Db, values: { auth0Id: string; email: string; fullName: string }) {
  const [u] = await db.insert(users).values(values).returning();
  return u;
}

export type RoleAssignment = { parishId: string; role: any; consolidatedAccess: boolean };

export const insertRoles = (db: Db | Tx, userId: string, roles: RoleAssignment[]) =>
  db.insert(userParishRoles).values(roles.map((r) => ({ userId, parishId: r.parishId, role: r.role, consolidatedAccess: r.consolidatedAccess })));

export const listRolesIn = (tx: Tx, userId: string, parishIds: string[]) =>
  tx.select().from(userParishRoles).where(and(eq(userParishRoles.userId, userId), inArray(userParishRoles.parishId, parishIds)));

export const deleteRolesIn = (tx: Tx, userId: string, parishIds: string[]) =>
  tx.delete(userParishRoles).where(and(eq(userParishRoles.userId, userId), inArray(userParishRoles.parishId, parishIds)));

export async function setActive(db: Db, id: string, active: boolean) {
  const [u] = await db.update(users).set({ active }).where(eq(users.id, id)).returning();
  return u;
}

/** Emails of active Administrateurs (any parish). */
export const listAdminEmails = (db: Db) =>
  db.selectDistinct({ email: users.email }).from(users)
    .innerJoin(userParishRoles, eq(userParishRoles.userId, users.id))
    .where(and(eq(userParishRoles.role, "administrateur"), eq(users.active, true)));

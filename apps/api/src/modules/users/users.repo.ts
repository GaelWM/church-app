import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLog, userParishRoles, users, type Db, type Tx } from "@church/db";

export const listWithRoles = (db: Db, parishIds: string[]) =>
  db.select({ user: users, role: userParishRoles }).from(users)
    .innerJoin(userParishRoles, eq(userParishRoles.userId, users.id)).where(inArray(userParishRoles.parishId, parishIds));

export async function findById(db: Db, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u;
}

/** Case-insensitive: Auth0 lowercases emails, so two casings are the same account. */
export async function findByEmail(db: Db, email: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
  return u;
}

export const listRoles = (db: Db, userId: string) => db.select().from(userParishRoles).where(eq(userParishRoles.userId, userId));

export async function insertUser(db: Db, values: { auth0Id: string; email: string; fullName: string }) {
  const [u] = await db.insert(users).values(values).returning();
  return u;
}

export async function updateUser(tx: Tx, id: string, values: { email?: string; fullName?: string }) {
  const [u] = await tx.update(users).set(values).where(eq(users.id, id)).returning();
  return u;
}

export async function deleteUser(tx: Tx, id: string) {
  await tx.delete(userParishRoles).where(eq(userParishRoles.userId, id));
  await tx.delete(users).where(eq(users.id, id));
}

/** audit_log.actor_id has no foreign key, so the database alone would not keep these entries' author. */
export async function hasAuditActions(db: Db, id: string) {
  const [row] = await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.actorId, id)).limit(1);
  return !!row;
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

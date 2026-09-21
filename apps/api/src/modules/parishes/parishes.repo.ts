import { eq } from "drizzle-orm";
import { parishes, userParishRoles, type Db } from "@church/db";

export type ParishInsert = typeof parishes.$inferInsert;

export async function insertParish(db: Db, values: ParishInsert) {
  const [p] = await db.insert(parishes).values(values).returning();
  return p;
}

export const insertAdminRole = (db: Db, userId: string, parishId: string) =>
  db.insert(userParishRoles).values({ userId, parishId, role: "administrateur" });

export async function updateParish(db: Db, id: string, values: Partial<ParishInsert>) {
  const [p] = await db.update(parishes).set(values).where(eq(parishes.id, id)).returning();
  return p;
}

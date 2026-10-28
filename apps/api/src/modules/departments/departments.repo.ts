import { and, eq } from "drizzle-orm";
import { departments, type Tx } from "@church/db";

export const listDepartments = (tx: Tx) => tx.select().from(departments).orderBy(departments.name);

export const listParishDepartments = (tx: Tx, parishId: string) => tx.select().from(departments).where(eq(departments.parishId, parishId));

export const findDepartment = async (tx: Tx, id: string, parishId: string) =>
  (await tx.select().from(departments).where(and(eq(departments.id, id), eq(departments.parishId, parishId))))[0];

export async function insertDepartment(tx: Tx, parishId: string, name: string) {
  const [d] = await tx.insert(departments).values({ parishId, name }).returning();
  return d;
}

export async function updateDepartment(tx: Tx, id: string, name: string) {
  const [d] = await tx.update(departments).set({ name }).where(eq(departments.id, id)).returning();
  return d;
}

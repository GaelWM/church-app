import { departments, type Tx } from "@church/db";

export const listDepartments = (tx: Tx) => tx.select().from(departments);

export async function insertDepartment(tx: Tx, parishId: string, name: string) {
  const [d] = await tx.insert(departments).values({ parishId, name }).returning();
  return d;
}

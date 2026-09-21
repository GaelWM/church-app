import { eq } from "drizzle-orm";
import { accounts, type Tx } from "@church/db";
import type { AccountUpdateInput } from "./accounts.dto";

export const listAccounts = (tx: Tx) => tx.select().from(accounts);

export async function insertAccount(tx: Tx, values: typeof accounts.$inferInsert) {
  const [a] = await tx.insert(accounts).values(values).returning();
  return a;
}

export async function updateAccount(tx: Tx, id: string, values: AccountUpdateInput) {
  const [a] = await tx.update(accounts).set(values).where(eq(accounts.id, id)).returning();
  return a;
}

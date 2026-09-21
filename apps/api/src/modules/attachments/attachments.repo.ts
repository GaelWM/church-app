import { eq } from "drizzle-orm";
import { attachments, transactions, type Tx } from "@church/db";

export const listByTransaction = (tx: Tx, transactionId: string) => tx.select().from(attachments).where(eq(attachments.transactionId, transactionId));

export async function findTransaction(tx: Tx, id: string) {
  const [t] = await tx.select().from(transactions).where(eq(transactions.id, id));
  return t;
}

export async function insert(tx: Tx, values: typeof attachments.$inferInsert) {
  const [a] = await tx.insert(attachments).values(values).returning();
  return a!;
}

export async function findById(tx: Tx, id: string) {
  return (await tx.select().from(attachments).where(eq(attachments.id, id)))[0];
}

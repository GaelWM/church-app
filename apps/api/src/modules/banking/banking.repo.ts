import { and, eq, inArray, sql } from "drizzle-orm";
import { categories, periods, transactionEvents, transactions, type Tx } from "@church/db";

export type TransactionInsert = typeof transactions.$inferInsert;

export async function findBankCategoryByName(tx: Tx, name: string) {
  const [cat] = await tx.select().from(categories).where(and(eq(categories.kind, "banque"), eq(categories.name, name)));
  return cat;
}

/** Inserts the legs and their initial "brouillon" events. */
export async function insertOperation(tx: Tx, rows: TransactionInsert[], actorId: string) {
  const inserted = await tx.insert(transactions).values(rows).returning();
  await tx.insert(transactionEvents).values(inserted.map((r) => ({ transactionId: r.id, toStatus: "brouillon", actorId })));
  return inserted;
}

export const listValidatedForMonth = (tx: Tx, accountId: string, year: number, month: number) =>
  tx.select().from(transactions).where(and(
    eq(transactions.accountId, accountId), eq(transactions.status, "validee"),
    sql`extract(year from ${transactions.date}) = ${year}`, sql`extract(month from ${transactions.date}) = ${month}`));

export const setReconciled = (tx: Tx, ids: string[], matched: boolean) =>
  tx.update(transactions).set({ reconciledAt: matched ? new Date() : null })
    .where(and(inArray(transactions.id, ids), eq(transactions.status, "validee")));

export const listPeriods = (tx: Tx) => tx.select().from(periods);

export async function countPendingInMonth(tx: Tx, parishId: string, year: number, month: number) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(transactions).where(and(
    eq(transactions.parishId, parishId), inArray(transactions.status, ["brouillon", "soumise", "validee1"]),
    sql`extract(year from ${transactions.date}) = ${year}`, sql`extract(month from ${transactions.date}) = ${month}`));
  return r!.n;
}

export const upsertClosedPeriod = (tx: Tx, parishId: string, year: number, month: number, userId: string) =>
  tx.insert(periods).values({ parishId, year, month, closedBy: userId, closedAt: new Date() })
    .onConflictDoUpdate({ target: [periods.parishId, periods.year, periods.month], set: { closedBy: userId, closedAt: new Date() } });

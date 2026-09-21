import { and, desc, eq, ne, sql } from "drizzle-orm";
import { accounts, commitments, engagementReleases, members, pledges, transactions, type Tx } from "@church/db";

export type Kind = "pledges" | "commitments";

export const listMembers = (tx: Tx) => tx.select().from(members);
export const listPledges = (tx: Tx) => tx.select().from(pledges);
export const listCommitments = (tx: Tx) => tx.select().from(commitments);
export const listActiveCommitments = (tx: Tx) => tx.select().from(commitments).where(ne(commitments.status, "cancelled"));

/** Sum of releases per engagement id. */
export async function releaseTotals(tx: Tx, col: "pledgeId" | "commitmentId") {
  const c = engagementReleases[col];
  const rows = await tx.select({ id: c, s: sql<string>`sum(${engagementReleases.amountMinor})::text` }).from(engagementReleases).where(sql`${c} is not null`).groupBy(c);
  return new Map(rows.map((r) => [r.id!, BigInt(r.s)]));
}

export async function insertPledge(tx: Tx, values: typeof pledges.$inferInsert) {
  const [p] = await tx.insert(pledges).values(values).returning();
  return p!;
}

export async function insertCommitment(tx: Tx, values: typeof commitments.$inferInsert) {
  const [m] = await tx.insert(commitments).values(values).returning();
  return m!;
}

export async function markCommitmentPaid(tx: Tx, id: string, transactionId: string) {
  const [m] = await tx.update(commitments).set({ status: "paid", transactionId }).where(eq(commitments.id, id)).returning();
  return m;
}

export const listReleases = (tx: Tx, kind: Kind, id: string) =>
  tx.select().from(engagementReleases)
    .where(eq(kind === "pledges" ? engagementReleases.pledgeId : engagementReleases.commitmentId, id))
    .orderBy(desc(engagementReleases.date), desc(engagementReleases.createdAt));

export async function findEngagement(tx: Tx, isPledge: boolean, id: string) {
  const [eng] = isPledge ? await tx.select().from(pledges).where(eq(pledges.id, id)) : await tx.select().from(commitments).where(eq(commitments.id, id));
  return eng;
}

export async function findAccountInParish(tx: Tx, id: string, parishId: string) {
  const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.parishId, parishId)));
  return a;
}

export async function findTransactionInParish(tx: Tx, id: string, parishId: string) {
  const [t] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.parishId, parishId)));
  return t;
}

export async function findReleaseByTransaction(tx: Tx, transactionId: string) {
  const [dup] = await tx.select({ id: engagementReleases.id }).from(engagementReleases).where(eq(engagementReleases.transactionId, transactionId));
  return dup;
}

export async function insertRelease(tx: Tx, values: typeof engagementReleases.$inferInsert) {
  const [r] = await tx.insert(engagementReleases).values(values).returning();
  return r!;
}

export async function findRelease(tx: Tx, id: string) {
  const [r] = await tx.select().from(engagementReleases).where(eq(engagementReleases.id, id));
  return r;
}

export async function setReleaseFile(tx: Tx, id: string, r2Key: string, filename: string) {
  const [u] = await tx.update(engagementReleases).set({ r2Key, filename }).where(eq(engagementReleases.id, id)).returning();
  return u!;
}

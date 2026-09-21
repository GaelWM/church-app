import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { categories, changeRequestEvents, changeRequests, departments, transactionEvents, transactions, users, type Tx } from "@church/db";
import { inList } from "../../services/sql";

export type TransactionRow = typeof transactions.$inferSelect;
export type ChangeRequestRow = typeof changeRequests.$inferSelect;

const requester = alias(users, "requester");
const tresorier = alias(users, "tresorier");
const pasteur = alias(users, "pasteur");

/** Request joined with entry + the three approver names. */
export const selectRequests = (tx: Tx) =>
  tx.select({
    r: changeRequests, txReference: transactions.reference, txDescription: transactions.description,
    txAmountMinor: transactions.amountMinor, txCurrency: transactions.currency, txStatus: transactions.status, txDate: transactions.date,
    requesterName: requester.fullName, tresorierName: tresorier.fullName, pasteurName: pasteur.fullName,
  }).from(changeRequests)
    .innerJoin(transactions, eq(transactions.id, changeRequests.transactionId))
    .innerJoin(requester, eq(requester.id, changeRequests.requesterId))
    .leftJoin(tresorier, eq(tresorier.id, changeRequests.tresorierId))
    .leftJoin(pasteur, eq(pasteur.id, changeRequests.pasteurId));

export type RequestRow = Awaited<ReturnType<typeof selectRequests>>[number];

export const listRequests = (tx: Tx, f: { parishId?: string | null; status?: string; requesterId?: string }) => {
  const w = [
    f.parishId ? eq(changeRequests.parishId, f.parishId) : undefined,
    f.status ? sql`${changeRequests.status} in (${inList(f.status.split(","))})` : undefined,
    f.requesterId ? eq(changeRequests.requesterId, f.requesterId) : undefined,
  ].filter(Boolean) as any[];
  return selectRequests(tx).where(and(...w)).orderBy(desc(changeRequests.createdAt)).limit(500);
};

export const findRequestView = async (tx: Tx, id: string) => (await selectRequests(tx).where(eq(changeRequests.id, id)))[0];

export const listEvents = (tx: Tx, requestId: string) =>
  tx.select({ e: changeRequestEvents, actor: users.fullName }).from(changeRequestEvents)
    .innerJoin(users, eq(users.id, changeRequestEvents.actorId))
    .where(eq(changeRequestEvents.requestId, requestId)).orderBy(changeRequestEvents.at);

export const lockRequest = async (tx: Tx, id: string) =>
  (await tx.select().from(changeRequests).where(eq(changeRequests.id, id)).for("update"))[0];

export const lockTransaction = async (tx: Tx, id: string) =>
  (await tx.select().from(transactions).where(eq(transactions.id, id)).for("update"))[0];

export const listGroupIds = async (tx: Tx, groupId: string) =>
  (await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.transferGroupId, groupId))).map((r) => r.id);

export const listGroupRows = (tx: Tx, groupId: string) =>
  tx.select().from(transactions).where(eq(transactions.transferGroupId, groupId));

export async function findOpenRequest(tx: Tx, transactionIds: string[], openStatuses: string[]) {
  const [open] = await tx.select({ id: changeRequests.id }).from(changeRequests)
    .where(and(inArray(changeRequests.transactionId, transactionIds), inArray(changeRequests.status, openStatuses)));
  return open;
}

export async function nextRequestReference(tx: Tx, parishId: string, year: number) {
  const refRows = await tx.execute(sql`select next_request_reference(${parishId}::uuid, ${year}::int) as ref`);
  return (refRows as any)[0].ref as string;
}

export async function insertRequest(tx: Tx, values: typeof changeRequests.$inferInsert) {
  const [req] = await tx.insert(changeRequests).values(values).returning();
  return req!;
}

export const insertEvent = (tx: Tx, values: typeof changeRequestEvents.$inferInsert) => tx.insert(changeRequestEvents).values(values);

export const updateRequest = (tx: Tx, id: string, patch: Partial<typeof changeRequests.$inferInsert>) =>
  tx.update(changeRequests).set(patch).where(eq(changeRequests.id, id));

export async function findCategory(tx: Tx, id: string) {
  const [cat] = await tx.select().from(categories).where(eq(categories.id, id));
  return cat;
}

export async function findDepartmentInParish(tx: Tx, id: string, parishId: string) {
  const [d] = await tx.select().from(departments).where(and(eq(departments.id, id), eq(departments.parishId, parishId)));
  return d;
}

/** Lets the DB trigger accept edits to a validated entry for the rest of this transaction. */
export const enableChangeRequestExec = (tx: Tx) => tx.execute(sql`select set_config('app.change_request_exec', 'on', true)`);

export const cancelTransaction = (tx: Tx, id: string) => tx.update(transactions).set({ status: "annulee" }).where(eq(transactions.id, id));

export const patchTransaction = (tx: Tx, id: string, patch: Record<string, unknown>) => tx.update(transactions).set(patch).where(eq(transactions.id, id));

export const insertTransactionEvent = (tx: Tx, values: typeof transactionEvents.$inferInsert) => tx.insert(transactionEvents).values(values);

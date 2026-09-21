import { and, desc, eq, getTableColumns, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { accounts, categories, commitments, settings, transactionEvents, transactions, users, type Tx } from "@church/db";
import { inList } from "../../services/sql";
import type { Filters } from "./transactions.dto";

export type TransactionInsert = typeof transactions.$inferInsert;
export type TransactionUpdate = Partial<TransactionInsert>;

const ent = alias(users, "ent"), u1 = alias(users, "u1"), u2 = alias(users, "u2");
const withNames = { ...getTableColumns(transactions), enteredByName: ent.fullName, validator1Name: u1.fullName, validator2Name: u2.fullName };

export async function findCategory(tx: Tx, id: string) {
  const [cat] = await tx.select().from(categories).where(eq(categories.id, id));
  return cat;
}

export async function findPieceModeSetting(tx: Tx, parishId: string) {
  const [s] = await tx.select().from(settings).where(and(eq(settings.parishId, parishId), eq(settings.key, "piece_number_mode")));
  return s;
}

export async function findCommitment(tx: Tx, id: string, parishId: string) {
  const [m] = await tx.select().from(commitments).where(and(eq(commitments.id, id), eq(commitments.parishId, parishId)));
  return m;
}

export async function findAccount(tx: Tx, id: string) {
  const [a] = await tx.select().from(accounts).where(eq(accounts.id, id));
  return a;
}

export async function findById(tx: Tx, id: string) {
  const [row] = await tx.select().from(transactions).where(eq(transactions.id, id));
  return row;
}

export async function findReversalOf(tx: Tx, id: string) {
  const [already] = await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.reversesId, id));
  return already;
}

export async function idsInTransferGroup(tx: Tx, groupId: string) {
  return (await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.transferGroupId, groupId))).map((r) => r.id);
}

/** List with filters, names of initiator and validators included. */
export function list(tx: Tx, q: Filters, parishId: string | undefined) {
  const w = [
    q.kind && inArray(transactions.kind, q.kind.split(",")),
    q.status && inArray(transactions.status, q.status.split(",")),
    q.accountId && eq(transactions.accountId, q.accountId),
    q.categoryId && eq(transactions.categoryId, q.categoryId),
    q.currency && eq(transactions.currency, q.currency),
    q.enteredBy && eq(transactions.enteredBy, q.enteredBy),
    q.from && gte(transactions.date, q.from),
    q.to && lte(transactions.date, q.to),
    parishId && eq(transactions.parishId, parishId),
  ].filter(Boolean) as any[];
  return tx.select(withNames).from(transactions)
    .leftJoin(ent, eq(ent.id, transactions.enteredBy)).leftJoin(u1, eq(u1.id, transactions.validator1Id)).leftJoin(u2, eq(u2.id, transactions.validator2Id))
    .where(and(...w)).orderBy(desc(transactions.date), desc(transactions.createdAt)).limit(500);
}

export function listPeople(tx: Tx, pid: string | undefined) {
  return tx.execute(sql`
      select u.id, u.full_name as "fullName",
        exists (select 1 from transactions t where t.entered_by = u.id ${pid ? sql`and t.parish_id = ${pid}::uuid` : sql``}) as initiator,
        exists (select 1 from transactions t where (t.validator1_id = u.id or t.validator2_id = u.id) ${pid ? sql`and t.parish_id = ${pid}::uuid` : sql``}) as validator
      from users u order by u.full_name`);
}

/**
 * Journal predicate on alias `j` (period and status handled by the caller so the opening balance can reuse it).
 * Shared by the rows and the summary so both always agree.
 */
function journalWhere(q: Filters) {
  const like = q.q?.trim() ? `%${q.q.trim().replace(/[\\%_]/g, "\\$&")}%` : null;
  return sql`
    ${q.accountId ? sql`and j.account_id = ${q.accountId}::uuid` : sql``}
    ${q.kind ? sql`and j.kind in (${inList(q.kind.split(","))})` : sql``}
    ${q.categoryId ? sql`and j.category_id = ${q.categoryId}::uuid` : sql``}
    ${q.currency ? sql`and j.currency = ${q.currency}` : sql``}
    ${q.enteredBy ? sql`and j.entered_by = ${q.enteredBy}::uuid` : sql``}
    ${q.validatorId ? sql`and (j.validator1_id = ${q.validatorId}::uuid or j.validator2_id = ${q.validatorId}::uuid)` : sql``}
    ${like ? sql`and (j.reference ilike ${like} or j.document_number ilike ${like} or j.description ilike ${like})` : sql``}`;
}

export function journalRows(tx: Tx, q: Filters, pid: string | undefined, limit: number) {
  const parishFilter = pid ? sql`and t.parish_id = ${pid}::uuid` : sql``;
  return tx.execute(sql`
        select j.id, j.reference, j.kind, j.direction, j.status, j.date, j.created_at as "createdAt", j.currency,
          j.account_id as "accountId", a.name as "accountName", j.category_id as "categoryId", c.name as "categoryName",
          j.sub_category as "subCategory", j.document_number as "documentNumber", j.description, j.beneficiary,
          j.amount_minor::text as "amountMinor", j.running_balance as "runningBalance", j.reverses_id as "reversesId", j.transfer_group_id as "transferGroupId",
          j.entered_by as "enteredBy", ue.full_name as "enteredByName",
          j.validator1_id as "validator1Id", u1.full_name as "validator1Name", j.validator1_at as "validator1At",
          j.validator2_id as "validator2Id", u2.full_name as "validator2Name", j.validator2_at as "validator2At"
        from (
          select t.*, sum(case when t.status = 'validee' then (case when t.direction = 'in' then t.amount_minor else -t.amount_minor end) else 0 end)
            over (partition by t.account_id order by t.date, t.created_at, t.id)::text as running_balance
          from transactions t where true ${parishFilter}
        ) j
        left join accounts a on a.id = j.account_id
        left join categories c on c.id = j.category_id
        left join users ue on ue.id = j.entered_by
        left join users u1 on u1.id = j.validator1_id
        left join users u2 on u2.id = j.validator2_id
        where true ${journalWhere(q)}
          ${q.status ? sql`and j.status in (${inList(q.status.split(","))})` : sql``}
          ${q.from ? sql`and j.date >= ${q.from}::date` : sql``}
          ${q.to ? sql`and j.date <= ${q.to}::date` : sql``}
        order by j.date, j.created_at, j.id limit ${limit + 1}`);
}

export function journalSummary(tx: Tx, q: Filters, pid: string | undefined) {
  return tx.execute(sql`
        select j.currency,
          coalesce(sum(case when ${q.from ?? null}::date is not null and j.date < ${q.from ?? null}::date then (case when j.direction='in' then j.amount_minor else -j.amount_minor end) else 0 end),0)::text as opening,
          coalesce(sum(case when j.direction='in' and (${q.from ?? null}::date is null or j.date >= ${q.from ?? null}::date) then j.amount_minor else 0 end),0)::text as "in",
          coalesce(sum(case when j.direction='out' and (${q.from ?? null}::date is null or j.date >= ${q.from ?? null}::date) then j.amount_minor else 0 end),0)::text as "out",
          coalesce(sum(case when j.kind='recette' and (${q.from ?? null}::date is null or j.date >= ${q.from ?? null}::date) then j.amount_minor else 0 end),0)::text as recettes,
          coalesce(sum(case when j.kind='depense' and (${q.from ?? null}::date is null or j.date >= ${q.from ?? null}::date) then j.amount_minor else 0 end),0)::text as depenses
        from transactions j
        where j.status = 'validee' ${pid ? sql`and j.parish_id = ${pid}::uuid` : sql``} ${journalWhere(q)}
          ${q.to ? sql`and j.date <= ${q.to}::date` : sql``}
        group by j.currency order by j.currency`);
}

export async function findDetail(tx: Tx, id: string) {
  const [row] = await tx.select(withNames).from(transactions)
    .leftJoin(ent, eq(ent.id, transactions.enteredBy)).leftJoin(u1, eq(u1.id, transactions.validator1Id)).leftJoin(u2, eq(u2.id, transactions.validator2Id))
    .where(eq(transactions.id, id));
  if (!row) return undefined;
  const events = await tx.select({ e: transactionEvents, actor: users.fullName }).from(transactionEvents)
    .innerJoin(users, eq(users.id, transactionEvents.actorId))
    .where(eq(transactionEvents.transactionId, row.id)).orderBy(transactionEvents.at);
  return { ...row, events };
}

export async function insertTransaction(tx: Tx, values: TransactionInsert) {
  const [row] = await tx.insert(transactions).values(values).returning();
  return row!;
}

export const insertDraftEvent = (tx: Tx, transactionId: string, actorId: string, comment?: string) =>
  tx.insert(transactionEvents).values({ transactionId, toStatus: "brouillon", actorId, comment });

export async function updateTransaction(tx: Tx, id: string, set: TransactionUpdate) {
  const [upd] = await tx.update(transactions).set(set).where(eq(transactions.id, id)).returning();
  return upd!;
}

/** Deletes the events then the rows. */
export async function deleteWithEvents(tx: Tx, ids: string[]) {
  await tx.delete(transactionEvents).where(inArray(transactionEvents.transactionId, ids));
  await tx.delete(transactions).where(inArray(transactions.id, ids));
}

export async function findUserById(db: { select: Tx["select"] }, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u;
}

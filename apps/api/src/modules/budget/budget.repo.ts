import { and, eq, ne, sql } from "drizzle-orm";
import { budgetExpenseLines, budgetInvestments, categories, transactions, type Tx } from "@church/db";

export type ExpenseLineInsert = typeof budgetExpenseLines.$inferInsert;
export type ExpenseLineUpdate = Partial<ExpenseLineInsert>;
export type InvestmentInsert = typeof budgetInvestments.$inferInsert;
export type InvestmentUpdate = Partial<InvestmentInsert>;

export async function findCategory(tx: Tx, id: string) {
  const [cat] = await tx.select().from(categories).where(eq(categories.id, id));
  return cat;
}

// ---- Expense lines (Budget des dépenses) --------------------------------------------------

export function listExpenseLines(tx: Tx, parishId: string | undefined, year: number) {
  const w = [eq(budgetExpenseLines.year, year), parishId ? eq(budgetExpenseLines.parishId, parishId) : undefined].filter(Boolean) as any[];
  return tx.select({
    id: budgetExpenseLines.id, parishId: budgetExpenseLines.parishId, year: budgetExpenseLines.year,
    categoryId: budgetExpenseLines.categoryId, categoryName: categories.name, categoryGroup: categories.group,
    period: budgetExpenseLines.period, periodIndex: budgetExpenseLines.periodIndex,
    currency: budgetExpenseLines.currency, amountMinor: budgetExpenseLines.amountMinor,
    observation: budgetExpenseLines.observation, createdBy: budgetExpenseLines.createdBy,
    createdAt: budgetExpenseLines.createdAt, updatedAt: budgetExpenseLines.updatedAt,
  }).from(budgetExpenseLines)
    .innerJoin(categories, eq(categories.id, budgetExpenseLines.categoryId))
    .where(and(...w))
    .orderBy(categories.group, categories.name, budgetExpenseLines.period, budgetExpenseLines.periodIndex);
}

/**
 * Live "réalisé" per expense line: validated dépenses in the line's own category, within the line's own
 * period window (annuel = the whole year; trimestriel = that quarter's 3 months; mensuel = that month),
 * excluding investment-linked spending. One aggregate query covers every line of the (parish, year) pair, no N+1.
 * Cross-currency amounts are converted using each transaction's own frozen rate, signed by direction.
 */
export async function realizedForExpenseLines(tx: Tx, parishId: string | undefined, year: number) {
  const rows = await tx.execute(sql`
    select bel.id,
      coalesce(sum(
        (case when t.direction = 'out' then 1 else -1 end) *
        case when bel.currency = 'USD' then t.amount_usd_minor
             when t.currency = 'CDF' then t.amount_minor
             else round(t.amount_minor * t.rate_used::numeric)::bigint end
      ), 0)::text as realized
    from budget_expense_lines bel
    left join transactions t
      on t.parish_id = bel.parish_id and t.category_id = bel.category_id
      and t.kind = 'depense' and t.status = 'validee' and t.investment_id is null
      and t.date >= case bel.period
          when 'annuel' then make_date(bel.year, 1, 1)
          when 'trimestriel' then make_date(bel.year, (bel.period_index - 1) * 3 + 1, 1)
          else make_date(bel.year, bel.period_index, 1) end
      and t.date < case bel.period
          when 'annuel' then make_date(bel.year + 1, 1, 1)
          when 'trimestriel' then (make_date(bel.year, (bel.period_index - 1) * 3 + 1, 1) + interval '3 months')::date
          else (make_date(bel.year, bel.period_index, 1) + interval '1 month')::date end
    where bel.year = ${year} ${parishId ? sql`and bel.parish_id = ${parishId}::uuid` : sql``}
    group by bel.id`);
  return new Map([...rows].map((r: any) => [r.id as string, BigInt(r.realized)]));
}

export async function findExpenseLine(tx: Tx, id: string) {
  const [row] = await tx.select().from(budgetExpenseLines).where(eq(budgetExpenseLines.id, id));
  return row;
}

/** Periods already in use for (parish, year, category, currency), optionally excluding one line (for update). Used to reject mixed granularities. */
export async function periodsInUse(tx: Tx, parishId: string, year: number, categoryId: string, currency: string, excludeId?: string) {
  const w = [
    eq(budgetExpenseLines.parishId, parishId), eq(budgetExpenseLines.year, year),
    eq(budgetExpenseLines.categoryId, categoryId), eq(budgetExpenseLines.currency, currency),
    excludeId ? ne(budgetExpenseLines.id, excludeId) : undefined,
  ].filter(Boolean) as any[];
  const rows = await tx.select({ period: budgetExpenseLines.period }).from(budgetExpenseLines).where(and(...w));
  return new Set(rows.map((r) => r.period));
}

export async function insertExpenseLine(tx: Tx, values: ExpenseLineInsert) {
  const [row] = await tx.insert(budgetExpenseLines).values(values).returning();
  return row!;
}

export async function updateExpenseLine(tx: Tx, id: string, set: ExpenseLineUpdate) {
  const [row] = await tx.update(budgetExpenseLines).set({ ...set, updatedAt: new Date() }).where(eq(budgetExpenseLines.id, id)).returning();
  return row;
}

export async function deleteExpenseLine(tx: Tx, id: string) {
  await tx.delete(budgetExpenseLines).where(eq(budgetExpenseLines.id, id));
}

// ---- Investments (Budget d'investissement) -------------------------------------------------

export function listInvestments(tx: Tx, parishId: string | undefined, year: number) {
  const w = [eq(budgetInvestments.year, year), parishId ? eq(budgetInvestments.parishId, parishId) : undefined].filter(Boolean) as any[];
  return tx.select().from(budgetInvestments).where(and(...w)).orderBy(budgetInvestments.name);
}

/** Live "réalisé" per investment: validated dépenses linked via transactions.investment_id, no date-window restriction. */
export async function realizedForInvestments(tx: Tx, parishId: string | undefined, year: number) {
  const rows = await tx.execute(sql`
    select inv.id,
      coalesce(sum(
        (case when t.direction = 'out' then 1 else -1 end) *
        case when inv.currency = 'USD' then t.amount_usd_minor
             when t.currency = 'CDF' then t.amount_minor
             else round(t.amount_minor * t.rate_used::numeric)::bigint end
      ), 0)::text as realized
    from budget_investments inv
    left join transactions t on t.investment_id = inv.id and t.status = 'validee'
    where inv.year = ${year} ${parishId ? sql`and inv.parish_id = ${parishId}::uuid` : sql``}
    group by inv.id`);
  return new Map([...rows].map((r: any) => [r.id as string, BigInt(r.realized)]));
}

export function listActiveInvestmentOptions(tx: Tx, parishId: string | undefined) {
  const w = [eq(budgetInvestments.active, true), parishId ? eq(budgetInvestments.parishId, parishId) : undefined].filter(Boolean) as any[];
  return tx.select({ id: budgetInvestments.id, name: budgetInvestments.name, year: budgetInvestments.year, currency: budgetInvestments.currency })
    .from(budgetInvestments).where(and(...w)).orderBy(budgetInvestments.name);
}

export async function findInvestment(tx: Tx, id: string, parishId?: string) {
  const w = [eq(budgetInvestments.id, id), parishId ? eq(budgetInvestments.parishId, parishId) : undefined].filter(Boolean) as any[];
  const [row] = await tx.select().from(budgetInvestments).where(and(...w));
  return row;
}

export async function countLinkedTransactions(tx: Tx, investmentId: string) {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(transactions).where(eq(transactions.investmentId, investmentId));
  return row?.n ?? 0;
}

/** Drill-down: dépenses linked to an investment project (any status, any year -- spending can outlast the budget year). */
export function listInvestmentTransactions(tx: Tx, investmentId: string) {
  return tx.select({
    id: transactions.id, date: transactions.date, reference: transactions.reference, status: transactions.status,
    description: transactions.description, amountMinor: transactions.amountMinor, currency: transactions.currency,
  }).from(transactions).where(eq(transactions.investmentId, investmentId)).orderBy(transactions.date);
}

export async function insertInvestment(tx: Tx, values: InvestmentInsert) {
  const [row] = await tx.insert(budgetInvestments).values(values).returning();
  return row!;
}

export async function updateInvestment(tx: Tx, id: string, set: InvestmentUpdate) {
  const [row] = await tx.update(budgetInvestments).set({ ...set, updatedAt: new Date() }).where(eq(budgetInvestments.id, id)).returning();
  return row;
}

export async function deleteInvestment(tx: Tx, id: string) {
  await tx.delete(budgetInvestments).where(eq(budgetInvestments.id, id));
}

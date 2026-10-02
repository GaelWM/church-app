import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { periodIndexRange, type ExpenseLineInput, type ExpenseLinePatchInput, type InvestmentInput, type InvestmentPatchInput } from "./budget.dto";
import { audit } from "../../services/audit";
import * as repo from "./budget.repo";

/** Who is acting; parishId is undefined only in the read-only consolidated ("all") view. */
export type Actor = { userId: string; parishId?: string };

function withExpenseComputed<T extends { id: string; amountMinor: bigint }>(rows: T[], realized: Map<string, bigint>) {
  return rows.map((r) => {
    const realizedMinor = realized.get(r.id) ?? 0n;
    const varianceMinor = r.amountMinor - realizedMinor;
    const overBudget = realizedMinor > r.amountMinor;
    const consumptionBp = r.amountMinor > 0n ? Number((realizedMinor * 10000n) / r.amountMinor) : null;
    return { ...r, realizedMinor, varianceMinor, overBudget, consumptionBp };
  });
}

function withInvestmentComputed<T extends { id: string; amountMinor: bigint }>(rows: T[], realized: Map<string, bigint>) {
  return rows.map((r) => {
    const realizedMinor = realized.get(r.id) ?? 0n;
    const balanceMinor = r.amountMinor - realizedMinor;
    return { ...r, realizedMinor, balanceMinor };
  });
}

async function loadDepenseCategory(tx: Tx, id: string) {
  const cat = await repo.findCategory(tx, id);
  if (!cat || !cat.active || cat.kind !== "depense") throw new HTTPException(422, { message: "Catégorie invalide (doit être une catégorie de dépense active)" });
  return cat;
}

/** The DB unique index allows several periodIndex values per (category, year, currency), but never a mix of granularities. */
async function assertConsistentPeriod(tx: Tx, parishId: string, year: number, categoryId: string, currency: string, period: string, excludeId?: string) {
  const periods = await repo.periodsInUse(tx, parishId, year, categoryId, currency, excludeId);
  const other = [...periods].find((p) => p !== period);
  if (other) {
    throw new HTTPException(422, {
      message: `Cette catégorie a déjà des lignes de budget en périodicité "${other}" pour ${year} en ${currency} ; toutes les lignes d'une même catégorie/année/devise doivent partager la même périodicité.`,
    });
  }
}

// ---- Expense lines ---------------------------------------------------------------------------

export async function listExpenseLines(tx: Tx, actor: Actor, year: number) {
  const [rows, realized] = await Promise.all([
    repo.listExpenseLines(tx, actor.parishId, year),
    repo.realizedForExpenseLines(tx, actor.parishId, year),
  ]);
  return withExpenseComputed(rows, realized);
}

export async function createExpenseLine(tx: Tx, actor: Actor & { parishId: string }, b: ExpenseLineInput) {
  await loadDepenseCategory(tx, b.categoryId);
  await assertConsistentPeriod(tx, actor.parishId, b.year, b.categoryId, b.currency, b.period);
  const row = await repo.insertExpenseLine(tx, { parishId: actor.parishId, ...b, createdBy: actor.userId });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "budget.expense.create", entity: "budget_expense_line", entityId: row.id, after: row });
  return row;
}

export async function updateExpenseLine(tx: Tx, actor: Actor, id: string, b: ExpenseLinePatchInput) {
  const row = await repo.findExpenseLine(tx, id);
  if (!row) throw new HTTPException(404, { message: "Ligne de budget introuvable" });
  if (b.categoryId) await loadDepenseCategory(tx, b.categoryId);
  const year = b.year ?? row.year;
  const categoryId = b.categoryId ?? row.categoryId;
  const currency = b.currency ?? row.currency;
  const period = b.period ?? row.period;
  const periodIndex = b.periodIndex ?? row.periodIndex;
  const [min, max] = periodIndexRange(period as any);
  if (periodIndex < min || periodIndex > max) throw new HTTPException(422, { message: "periodIndex incohérent avec la période (annuel : 0, trimestriel : 1-4, mensuel : 1-12)" });
  await assertConsistentPeriod(tx, row.parishId, year, categoryId, currency, period, id);
  const upd = await repo.updateExpenseLine(tx, id, b);
  await audit(tx, { parishId: row.parishId, actorId: actor.userId, action: "budget.expense.update", entity: "budget_expense_line", entityId: id, before: row, after: upd });
  return upd;
}

export async function deleteExpenseLine(tx: Tx, actor: Actor, id: string) {
  const row = await repo.findExpenseLine(tx, id);
  if (!row) throw new HTTPException(404, { message: "Ligne de budget introuvable" });
  await repo.deleteExpenseLine(tx, id);
  await audit(tx, { parishId: row.parishId, actorId: actor.userId, action: "budget.expense.delete", entity: "budget_expense_line", entityId: id, before: row });
}

// ---- Investments ------------------------------------------------------------------------------

export async function listInvestments(tx: Tx, actor: Actor, year: number) {
  const [rows, realized] = await Promise.all([
    repo.listInvestments(tx, actor.parishId, year),
    repo.realizedForInvestments(tx, actor.parishId, year),
  ]);
  return withInvestmentComputed(rows, realized);
}

export const listInvestmentOptions = (tx: Tx, actor: Actor) => repo.listActiveInvestmentOptions(tx, actor.parishId);

export async function listInvestmentTransactions(tx: Tx, actor: Actor, id: string) {
  const inv = await repo.findInvestment(tx, id, actor.parishId);
  if (!inv) throw new HTTPException(404, { message: "Projet d'investissement introuvable" });
  return repo.listInvestmentTransactions(tx, id);
}

export async function createInvestment(tx: Tx, actor: Actor & { parishId: string }, b: InvestmentInput) {
  const row = await repo.insertInvestment(tx, { parishId: actor.parishId, ...b, createdBy: actor.userId });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "budget.investment.create", entity: "budget_investment", entityId: row.id, after: row });
  return row;
}

export async function updateInvestment(tx: Tx, actor: Actor, id: string, b: InvestmentPatchInput) {
  const row = await repo.findInvestment(tx, id, actor.parishId);
  if (!row) throw new HTTPException(404, { message: "Projet d'investissement introuvable" });
  const upd = await repo.updateInvestment(tx, id, b);
  await audit(tx, { parishId: row.parishId, actorId: actor.userId, action: "budget.investment.update", entity: "budget_investment", entityId: id, before: row, after: upd });
  return upd;
}

/** 409 (not a raw FK error) when a transaction is still linked to this investment. */
export async function deleteInvestment(tx: Tx, actor: Actor, id: string) {
  const row = await repo.findInvestment(tx, id, actor.parishId);
  if (!row) throw new HTTPException(404, { message: "Projet d'investissement introuvable" });
  const linked = await repo.countLinkedTransactions(tx, id);
  if (linked > 0) throw new HTTPException(409, { message: "Des écritures sont liées à ce projet d'investissement ; impossible de le supprimer." });
  await repo.deleteInvestment(tx, id);
  await audit(tx, { parishId: row.parishId, actorId: actor.userId, action: "budget.investment.delete", entity: "budget_investment", entityId: id, before: row });
}

// ---- Suivi & Écarts summary --------------------------------------------------------------------

/** Aggregated per currency: expenses + investments, planned vs realized, feeding the "Suivi & Écarts" tab. */
export async function summary(tx: Tx, actor: Actor, year: number) {
  const [lines, investments] = await Promise.all([listExpenseLines(tx, actor, year), listInvestments(tx, actor, year)]);
  const byCurrency = new Map<string, { plannedExpenses: bigint; realizedExpenses: bigint; plannedInvestments: bigint; realizedInvestments: bigint }>();
  const bucket = (currency: string) => {
    let b = byCurrency.get(currency);
    if (!b) { b = { plannedExpenses: 0n, realizedExpenses: 0n, plannedInvestments: 0n, realizedInvestments: 0n }; byCurrency.set(currency, b); }
    return b;
  };
  for (const l of lines) { const b = bucket(l.currency); b.plannedExpenses += l.amountMinor; b.realizedExpenses += l.realizedMinor; }
  for (const i of investments) { const b = bucket(i.currency); b.plannedInvestments += i.amountMinor; b.realizedInvestments += i.realizedMinor; }
  return [...byCurrency.entries()].map(([currency, b]) => {
    const totalPlanned = b.plannedExpenses + b.plannedInvestments;
    const totalRealized = b.realizedExpenses + b.realizedInvestments;
    const bp = totalPlanned > 0n ? (totalRealized * 10000n) / totalPlanned : null;
    return {
      currency,
      expenses: { planned: b.plannedExpenses, realized: b.realizedExpenses },
      investments: { planned: b.plannedInvestments, realized: b.realizedInvestments },
      total: { planned: totalPlanned, realized: totalRealized },
      consumptionBp: bp === null ? null : Number(bp),
    };
  });
}

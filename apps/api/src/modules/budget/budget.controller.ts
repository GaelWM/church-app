import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { ExpenseLineInput, ExpenseLinePatchInput, InvestmentInput, InvestmentPatchInput, YearQuery } from "./budget.dto";
import * as service from "./budget.service";

type C = Context<AppEnv>;
/** Reads: parishId may be undefined (consolidated "all" view). */
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: c.get("parishId") ?? undefined });
/** Writes: a specific parish is required (400 otherwise, same as every other write-gated module). */
const writerOf = (c: C): service.Actor & { parishId: string } => ({ userId: c.get("user").id, parishId: requireParish(c) });

export const listExpenseLines = async (c: C, q: YearQuery) => c.json(await run(c, (tx) => service.listExpenseLines(tx, actorOf(c), q.year)));

export const createExpenseLine = async (c: C, body: ExpenseLineInput) => {
  const actor = writerOf(c);
  return c.json(await run(c, (tx) => service.createExpenseLine(tx, actor, body)), 201);
};

export const updateExpenseLine = async (c: C, body: ExpenseLinePatchInput) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.updateExpenseLine(tx, actor, id, body)));
};

export const deleteExpenseLine = async (c: C) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  await run(c, (tx) => service.deleteExpenseLine(tx, actor, id));
  return c.json({ ok: true });
};

export const listInvestments = async (c: C, q: YearQuery) => c.json(await run(c, (tx) => service.listInvestments(tx, actorOf(c), q.year)));

export const listInvestmentOptions = async (c: C) => c.json(await run(c, (tx) => service.listInvestmentOptions(tx, actorOf(c))));

export const listInvestmentTransactions = async (c: C) => {
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.listInvestmentTransactions(tx, actorOf(c), id)));
};

export const createInvestment = async (c: C, body: InvestmentInput) => {
  const actor = writerOf(c);
  return c.json(await run(c, (tx) => service.createInvestment(tx, actor, body)), 201);
};

export const updateInvestment = async (c: C, body: InvestmentPatchInput) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.updateInvestment(tx, actor, id, body)));
};

export const deleteInvestment = async (c: C) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  await run(c, (tx) => service.deleteInvestment(tx, actor, id));
  return c.json({ ok: true });
};

export const summary = async (c: C, q: YearQuery) => c.json(await run(c, (tx) => service.summary(tx, actorOf(c), q.year)));

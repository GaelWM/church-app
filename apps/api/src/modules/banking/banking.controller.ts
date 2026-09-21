import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { BankOpInput, ClosePeriodInput, ReconcileInput, ReconciliationQuery } from "./banking.dto";
import * as service from "./banking.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });

export const createOperation = async (c: C, body: BankOpInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createOperation(tx, actor, body)), 201);
};

export const getReconciliation = async (c: C, query: ReconciliationQuery) =>
  c.json(await run(c, (tx) => service.getReconciliation(tx, query)));

export const reconcile = async (c: C, body: ReconcileInput) => {
  const actor = actorOf(c);
  await run(c, (tx) => service.reconcile(tx, actor, body));
  return c.json({ ok: true });
};

export const listPeriods = async (c: C) => c.json(await run(c, service.listPeriods));

export const closePeriod = async (c: C, body: ClosePeriodInput) => {
  const actor = actorOf(c);
  await run(c, (tx) => service.closePeriod(tx, actor, body));
  return c.json({ ok: true });
};

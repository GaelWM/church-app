import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { categories, changeRequestEvents, changeRequests, departments, transactionEvents, transactions, users, type Tx } from "@church/db";
import {
  can, changeRequestDecisionSchema, changeRequestInputSchema, changeRequestRejectSchema, changeRequestTransition,
  MODIFIABLE_TX_FIELDS, WorkflowError, type ChangeRequestAction, type ChangeRequestStatus,
} from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";
import { inList } from "../services/sql";

const OPEN = ["en_attente_tresorier", "approuvee_n1", "approuvee_n2"];
const actorOf = (c: any) => ({ id: c.get("user").id as string, roles: c.get("roles") as any[] });
const canReadAll = (c: any) => can(c.get("roles"), "transaction.readAll");

const requester = alias(users, "requester");
const tresorier = alias(users, "tresorier");
const pasteur = alias(users, "pasteur");

/** Request joined with entry + the three approver names. */
const selectRequests = (tx: Tx) =>
  tx.select({
    r: changeRequests, txReference: transactions.reference, txDescription: transactions.description,
    txAmountMinor: transactions.amountMinor, txCurrency: transactions.currency, txStatus: transactions.status, txDate: transactions.date,
    requesterName: requester.fullName, tresorierName: tresorier.fullName, pasteurName: pasteur.fullName,
  }).from(changeRequests)
    .innerJoin(transactions, eq(transactions.id, changeRequests.transactionId))
    .innerJoin(requester, eq(requester.id, changeRequests.requesterId))
    .leftJoin(tresorier, eq(tresorier.id, changeRequests.tresorierId))
    .leftJoin(pasteur, eq(pasteur.id, changeRequests.pasteurId));

const flat = (x: Awaited<ReturnType<typeof selectRequests>>[number]) => ({
  ...x.r, txReference: x.txReference, txDescription: x.txDescription, txAmountMinor: x.txAmountMinor, txCurrency: x.txCurrency,
  txStatus: x.txStatus, txDate: x.txDate, requesterName: x.requesterName, tresorierName: x.tresorierName, pasteurName: x.pasteurName,
});

async function validateChanges(tx: Tx, row: typeof transactions.$inferSelect, changes: Record<string, unknown>) {
  const grouped = !!row.transferGroupId;
  if (grouped && (changes.categoryId !== undefined || changes.departmentId !== undefined))
    throw new HTTPException(422, { message: "Catégorie et département non modifiables sur un transfert" });
  if (changes.categoryId) {
    const [cat] = await tx.select().from(categories).where(eq(categories.id, changes.categoryId as string));
    if (!cat || !cat.active || cat.kind !== row.kind) throw new HTTPException(422, { message: "Catégorie invalide" });
    if (cat.requiresDepartment && !(("departmentId" in changes ? changes.departmentId : row.departmentId)))
      throw new HTTPException(422, { message: "Département requis" });
  } else if (changes.categoryId === null) throw new HTTPException(422, { message: "Catégorie obligatoire" });
  if (changes.departmentId) {
    const [d] = await tx.select().from(departments).where(and(eq(departments.id, changes.departmentId as string), eq(departments.parishId, row.parishId)));
    if (!d) throw new HTTPException(422, { message: "Département invalide" });
  }
}

/** Runs inside the approve2 DB transaction: applies the approved change (and to every transfer leg). */
async function execute(tx: Tx, req: typeof changeRequests.$inferSelect, actorId: string) {
  const [row] = await tx.select().from(transactions).where(eq(transactions.id, req.transactionId)).for("update");
  if (!row) throw new HTTPException(404, { message: "Écriture introuvable" });
  if (row.status !== "validee") throw new HTTPException(422, { message: "L'écriture n'est plus validée" });
  const rows = row.transferGroupId
    ? await tx.select().from(transactions).where(eq(transactions.transferGroupId, row.transferGroupId))
    : [row];
  await tx.execute(sql`select set_config('app.change_request_exec', 'on', true)`);
  const changes = (req.proposedChanges ?? {}) as Record<string, unknown>;
  if (req.kind === "modification") await validateChanges(tx, row, changes);
  for (const r of rows) {
    if (r.status !== "validee") throw new HTTPException(422, { message: "L'écriture n'est plus validée" });
    if (req.kind === "annulation") {
      await tx.update(transactions).set({ status: "annulee" }).where(eq(transactions.id, r.id));
      await tx.insert(transactionEvents).values({ transactionId: r.id, fromStatus: r.status, toStatus: "annulee", actorId, comment: req.reason });
      await audit(tx, {
        parishId: r.parishId, actorId, action: "transaction.cancel", entity: "transaction", entityId: r.id,
        before: { status: r.status }, after: { status: "annulee", reason: req.reason, changeRequest: req.reference },
      });
    } else {
      const patch = Object.fromEntries(MODIFIABLE_TX_FIELDS.filter((f) => f in changes).map((f) => [f, changes[f]]));
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (r as any)[k]]));
      await tx.update(transactions).set(patch).where(eq(transactions.id, r.id));
      await tx.insert(transactionEvents).values({ transactionId: r.id, fromStatus: r.status, toStatus: r.status, actorId, comment: `Modification approuvée (${req.reference}): ${req.reason}` });
      await audit(tx, {
        parishId: r.parishId, actorId, action: "transaction.modify", entity: "transaction", entityId: r.id,
        before, after: { ...patch, reason: req.reason, changeRequest: req.reference },
      });
    }
  }
}

async function decide(c: any, action: ChangeRequestAction, comment?: string) {
  const actor = actorOf(c);
  const id = c.req.param("id");
  const out = await run(c, async (tx) => {
    const [req] = await tx.select().from(changeRequests).where(eq(changeRequests.id, id)).for("update");
    if (!req) throw new HTTPException(404, { message: "Demande introuvable" });
    let next: ChangeRequestStatus;
    try {
      next = changeRequestTransition({
        status: req.status as ChangeRequestStatus, action, actorId: actor.id, requesterId: req.requesterId,
        actorRoles: actor.roles, comment,
      });
    } catch (e) {
      if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
      throw e;
    }
    const now = new Date();
    const stamp = action === "approve1" ? { tresorierId: actor.id, tresorierAt: now }
      : action === "approve2" ? { pasteurId: actor.id, pasteurAt: now }
      : { rejectedReason: comment };
    await tx.update(changeRequests).set({ status: next, ...stamp }).where(eq(changeRequests.id, id));
    await tx.insert(changeRequestEvents).values({ requestId: id, fromStatus: req.status, toStatus: next, actorId: actor.id, comment: comment || null });
    await audit(tx, {
      parishId: req.parishId, actorId: actor.id, action: `change_request.${action}`, entity: "change_request", entityId: id,
      before: { status: req.status }, after: { status: next, comment },
    });
    if (next === "approuvee_n2") {
      await execute(tx, { ...req, ...stamp } as typeof req, actor.id);
      const executedAt = new Date();
      await tx.update(changeRequests).set({ status: "executee", executedAt }).where(eq(changeRequests.id, id));
      await tx.insert(changeRequestEvents).values({ requestId: id, fromStatus: "approuvee_n2", toStatus: "executee", actorId: actor.id });
      await audit(tx, {
        parishId: req.parishId, actorId: actor.id, action: "change_request.execute", entity: "change_request", entityId: id,
        before: { status: "approuvee_n2", oldValues: req.oldValues }, after: { status: "executee", kind: req.kind, proposedChanges: req.proposedChanges },
      });
    }
    const [full] = await selectRequests(tx).where(eq(changeRequests.id, id));
    return flat(full!);
  });
  return c.json(out);
}

/** Approvals take an optional JSON body {comment?}; an empty body is fine. */
async function approve(c: any, action: ChangeRequestAction) {
  const parsed = changeRequestDecisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: "Requête invalide" });
  return decide(c, action, parsed.data.comment || undefined);
}

export const changeRequestRoutes = new Hono<AppEnv>()
  .use(parishScope)

  .post("/", requirePerm("change.request"), zValidator("json", changeRequestInputSchema), async (c) => {
    const b = c.req.valid("json");
    const parishId = requireParish(c);
    const user = actorOf(c);
    const created = await run(c, async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, b.transactionId)).for("update");
      if (!row || row.parishId !== parishId) throw new HTTPException(404, { message: "Écriture introuvable" });
      if (row.status === "annulee") throw new HTTPException(422, { message: "Écriture déjà annulée" });
      if (row.status !== "validee") throw new HTTPException(422, { message: "Seule une écriture validée nécessite une demande" });
      const group = row.transferGroupId
        ? (await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.transferGroupId, row.transferGroupId))).map((r) => r.id)
        : [row.id];
      const [open] = await tx.select({ id: changeRequests.id }).from(changeRequests)
        .where(and(inArray(changeRequests.transactionId, group), inArray(changeRequests.status, OPEN)));
      if (open) throw new HTTPException(422, { message: "Une demande est déjà en cours pour cette écriture" });

      let proposed: Record<string, unknown> | null = null;
      let old: Record<string, unknown> | null = null;
      if (b.kind === "modification") {
        const ch = Object.fromEntries(Object.entries(b.changes ?? {}).filter(([k, v]) => (MODIFIABLE_TX_FIELDS as readonly string[]).includes(k) && v !== undefined));
        // Keep only fields that actually differ.
        proposed = Object.fromEntries(Object.entries(ch).filter(([k, v]) => ((row as any)[k] ?? null) !== (v === "" ? null : v)).map(([k, v]) => [k, v === "" ? null : v]));
        if (!Object.keys(proposed).length) throw new HTTPException(422, { message: "Aucune modification proposée" });
        await validateChanges(tx, row, proposed);
        old = Object.fromEntries(Object.keys(proposed).map((k) => [k, (row as any)[k] ?? null]));
      } else if (b.changes && Object.keys(b.changes).length) {
        throw new HTTPException(422, { message: "Une annulation ne porte pas de modifications" });
      }
      const year = new Date().getFullYear();
      const refRows = await tx.execute(sql`select next_request_reference(${parishId}::uuid, ${year}::int) as ref`);
      const reference = (refRows as any)[0].ref as string;
      const [req] = await tx.insert(changeRequests).values({
        parishId, reference, transactionId: row.id, kind: b.kind, reason: b.reason,
        proposedChanges: proposed, oldValues: old, requesterId: user.id,
      }).returning();
      await tx.insert(changeRequestEvents).values({ requestId: req!.id, toStatus: "en_attente_tresorier", actorId: user.id, comment: b.reason });
      await audit(tx, { parishId, actorId: user.id, action: "change_request.create", entity: "change_request", entityId: req!.id, after: req });
      return req!;
    });
    return c.json(created, 201);
  })

  .get("/", async (c) => {
    const roles = c.get("roles");
    const all = canReadAll(c);
    if (!all && !can(roles, "change.request")) throw new HTTPException(403, { message: "Permission refusée" });
    const status = c.req.query("status");
    const mine = c.req.query("mine") === "1";
    const rows = await run(c, (tx) => {
      const w = [
        c.get("parishId") ? eq(changeRequests.parishId, c.get("parishId")!) : undefined,
        status ? sql`${changeRequests.status} in (${inList(status.split(","))})` : undefined,
        mine || !all ? eq(changeRequests.requesterId, c.get("user").id) : undefined,
      ].filter(Boolean) as any[];
      return selectRequests(tx).where(and(...w)).orderBy(desc(changeRequests.createdAt)).limit(500);
    });
    return c.json(rows.map(flat));
  })

  .get("/:id", async (c) => {
    const all = canReadAll(c);
    const out = await run(c, async (tx) => {
      const [x] = await selectRequests(tx).where(eq(changeRequests.id, c.req.param("id")));
      if (!x) return null;
      if (!all && x.r.requesterId !== c.get("user").id) return null;
      const events = await tx.select({ e: changeRequestEvents, actor: users.fullName }).from(changeRequestEvents)
        .innerJoin(users, eq(users.id, changeRequestEvents.actorId))
        .where(eq(changeRequestEvents.requestId, x.r.id)).orderBy(changeRequestEvents.at);
      return { ...flat(x), events: events.map((e) => ({ ...e.e, actorName: e.actor })) };
    });
    if (!out) throw new HTTPException(404, { message: "Demande introuvable" });
    return c.json(out);
  })

  .post("/:id/approve1", requirePerm("transaction.validate1"), (c) => approve(c, "approve1"))
  .post("/:id/approve2", requirePerm("transaction.validate2"), (c) => approve(c, "approve2"))
  .post("/:id/reject", zValidator("json", changeRequestRejectSchema), (c) => decide(c, "reject", c.req.valid("json").comment));

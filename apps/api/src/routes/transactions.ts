import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { categories, transactionEvents, transactions, users, type Tx } from "@church/db";
import { batchActionSchema, isEditable, rejectSchema, transactionInputSchema, type TxAction } from "@church/shared";
import { rejected } from "@church/emails";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { getAccount, nextReference, usdEquivalent } from "../services/ledger";
import { safeSend } from "../services/mailer";
import { run } from "../services/run";
import { inList } from "../services/sql";
import { applyAction, applyBatch } from "../services/workflow";

const actorOf = (c: any) => ({ id: c.get("user").id as string, roles: c.get("roles") });

async function loadCategory(tx: Tx, id: string, kind: string) {
  const [cat] = await tx.select().from(categories).where(eq(categories.id, id));
  if (!cat || !cat.active || cat.kind !== kind) throw new HTTPException(422, { message: "Catégorie invalide" });
  return cat;
}

const filterSchema = z.object({
  kind: z.string().optional(), status: z.string().optional(), accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(), currency: z.string().optional(), enteredBy: z.string().uuid().optional(),
  from: z.string().optional(), to: z.string().optional(),
});

export const transactionRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // List with filters (Recettes / Dépenses / Banques menus and the À valider inbox).
  .get("/", zValidator("query", filterSchema.passthrough()), async (c) => {
    const q = c.req.valid("query");
    const rows = await run(c, (tx) => {
      const w = [
        q.kind && inArray(transactions.kind, q.kind.split(",")),
        q.status && inArray(transactions.status, q.status.split(",")),
        q.accountId && eq(transactions.accountId, q.accountId),
        q.categoryId && eq(transactions.categoryId, q.categoryId),
        q.currency && eq(transactions.currency, q.currency),
        q.enteredBy && eq(transactions.enteredBy, q.enteredBy),
        q.from && gte(transactions.date, q.from),
        q.to && lte(transactions.date, q.to),
        c.get("parishId") && eq(transactions.parishId, c.get("parishId")!),
      ].filter(Boolean) as any[];
      return tx.select().from(transactions).where(and(...w)).orderBy(desc(transactions.date), desc(transactions.createdAt)).limit(500);
    });
    return c.json(rows);
  })

  // Journal: same table, chronological, running balance per account (validated rows only).
  .get("/journal", zValidator("query", filterSchema.passthrough()), async (c) => {
    const q = c.req.valid("query");
    const parishFilter = c.get("parishId") ? sql`and t.parish_id = ${c.get("parishId")}::uuid` : sql``;
    const rows = await run(c, (tx) =>
      tx.execute(sql`
        select * from (
          select t.*, sum(case when t.status = 'validee' then (case when t.direction = 'in' then t.amount_minor else -t.amount_minor end) else 0 end)
            over (partition by t.account_id order by t.date, t.created_at, t.id)::text as running_balance
          from transactions t where true ${parishFilter}
        ) j
        where true
          ${q.accountId ? sql`and account_id = ${q.accountId}::uuid` : sql``}
          ${q.status ? sql`and status in (${inList(q.status.split(","))})` : sql``}
          ${q.kind ? sql`and kind in (${inList(q.kind.split(","))})` : sql``}
          ${q.categoryId ? sql`and category_id = ${q.categoryId}::uuid` : sql``}
          ${q.currency ? sql`and currency = ${q.currency}` : sql``}
          ${q.enteredBy ? sql`and entered_by = ${q.enteredBy}::uuid` : sql``}
          ${q.from ? sql`and date >= ${q.from}::date` : sql``}
          ${q.to ? sql`and date <= ${q.to}::date` : sql``}
        order by date, created_at, id limit 2000`),
    );
    return c.json([...rows]);
  })

  .get("/:id", async (c) => {
    const out = await run(c, async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, c.req.param("id")));
      if (!row) return null;
      const events = await tx.select({ e: transactionEvents, actor: users.fullName }).from(transactionEvents)
        .innerJoin(users, eq(users.id, transactionEvents.actorId))
        .where(eq(transactionEvents.transactionId, row.id)).orderBy(transactionEvents.at);
      return { ...row, events: events.map((x) => ({ ...x.e, actorName: x.actor })) };
    });
    if (!out) throw new HTTPException(404, { message: "Écriture introuvable" });
    return c.json(out);
  })

  // Create a recette or dépense (always starts as Brouillon).
  .post("/", requirePerm("transaction.create"), zValidator("json", transactionInputSchema), async (c) => {
    const b = c.req.valid("json");
    const parishId = requireParish(c);
    if (b.parishId !== parishId) throw new HTTPException(400, { message: "Paroisse incohérente" });
    const user = c.get("user");
    const created = await run(c, async (tx) => {
      const acct = await getAccount(tx, b.accountId, parishId);
      const cat = await loadCategory(tx, b.categoryId, b.kind);
      if (cat.requiresDepartment && !b.departmentId) throw new HTTPException(422, { message: "Département requis" });
      const currency = acct.currency as "CDF" | "USD";
      const { rate, usd } = await usdEquivalent(tx, b.date, currency, b.amountMinor);
      const reference = await nextReference(tx, parishId, Number(b.date.slice(0, 4)));
      const [row] = await tx.insert(transactions).values({
        parishId, reference, kind: b.kind, direction: b.kind === "recette" ? "in" : "out",
        accountId: b.accountId, categoryId: b.categoryId, currency, amountMinor: b.amountMinor,
        rateUsed: rate, amountUsdMinor: usd, date: b.date, status: "brouillon",
        description: b.description, beneficiary: b.beneficiary, documentNumber: b.documentNumber ?? b.reference,
        departmentId: b.departmentId, memberId: b.memberId, pledgeId: b.pledgeId, enteredBy: user.id,
      }).returning();
      await tx.insert(transactionEvents).values({ transactionId: row!.id, toStatus: "brouillon", actorId: user.id });
      await audit(tx, { parishId, actorId: user.id, action: "transaction.create", entity: "transaction", entityId: row!.id, after: row });
      return row!;
    });
    return c.json(created, 201);
  })

  // Edit own draft / rejected entry.
  .patch("/:id", requirePerm("transaction.create"), zValidator("json", transactionInputSchema.partial()), async (c) => {
    const b = c.req.valid("json");
    const user = c.get("user");
    const out = await run(c, async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, c.req.param("id")));
      if (!row) throw new HTTPException(404, { message: "Écriture introuvable" });
      if (row.enteredBy !== user.id || !isEditable(row.status as any) || row.transferGroupId)
        throw new HTTPException(422, { message: "Modification impossible" });
      const accountId = b.accountId ?? row.accountId;
      const acct = await getAccount(tx, accountId, row.parishId);
      const date = b.date ?? row.date;
      const amount = b.amountMinor ?? row.amountMinor;
      const currency = acct.currency as "CDF" | "USD";
      if (b.categoryId) await loadCategory(tx, b.categoryId, row.kind);
      const { rate, usd } = await usdEquivalent(tx, date, currency, amount);
      const [upd] = await tx.update(transactions).set({
        accountId, categoryId: b.categoryId ?? row.categoryId, date, currency, amountMinor: amount, rateUsed: rate,
        amountUsdMinor: usd, description: b.description ?? row.description, beneficiary: b.beneficiary ?? row.beneficiary,
        documentNumber: b.documentNumber ?? row.documentNumber, departmentId: b.departmentId ?? row.departmentId,
        memberId: b.memberId ?? row.memberId, pledgeId: b.pledgeId ?? row.pledgeId,
      }).where(eq(transactions.id, row.id)).returning();
      await audit(tx, { parishId: row.parishId, actorId: user.id, action: "transaction.update", entity: "transaction", entityId: row.id, before: row, after: upd });
      return upd!;
    });
    return c.json(out);
  })

  // Delete own draft before submission.
  .delete("/:id", requirePerm("transaction.create"), async (c) => {
    const user = c.get("user");
    await run(c, async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, c.req.param("id")));
      if (!row || row.enteredBy !== user.id || row.status !== "brouillon")
        throw new HTTPException(422, { message: "Suppression impossible" });
      const ids = row.transferGroupId
        ? (await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.transferGroupId, row.transferGroupId))).map((r) => r.id)
        : [row.id];
      await tx.delete(transactionEvents).where(inArray(transactionEvents.transactionId, ids));
      await tx.delete(transactions).where(inArray(transactions.id, ids));
      await audit(tx, { parishId: row.parishId, actorId: user.id, action: "transaction.delete", entity: "transaction", entityId: row.id, before: row });
    });
    return c.body(null, 204);
  })

  // Workflow actions.
  .post("/:id/submit", requirePerm("transaction.create"), (c) => act(c, "submit"))
  .post("/:id/validate1", requirePerm("transaction.validate1"), (c) => act(c, "validate1"))
  .post("/:id/validate2", requirePerm("transaction.validate2"), (c) => act(c, "validate2"))
  .post("/:id/reject", zValidator("json", rejectSchema), async (c) => act(c, "reject", c.req.valid("json").comment))

  // Batch validation for the À valider inboxes.
  .post("/batch/:action", zValidator("json", batchActionSchema.extend({ comment: z.string().optional() })), async (c) => {
    const action = c.req.param("action") as TxAction;
    if (!["submit", "validate1", "validate2", "reject"].includes(action)) throw new HTTPException(404);
    const { ids, comment } = c.req.valid("json");
    const results = await run(c, (tx) => applyBatch(tx, actorOf(c), ids, action, comment));
    return c.json({ results });
  })

  // Contre-passation: reversing entry linked to a validated original.
  .post("/:id/reverse", requirePerm("transaction.create"), zValidator("json", rejectSchema), async (c) => {
    const user = c.get("user");
    const { comment } = c.req.valid("json");
    const created = await run(c, async (tx) => {
      const [orig] = await tx.select().from(transactions).where(eq(transactions.id, c.req.param("id")));
      if (!orig || orig.status !== "validee") throw new HTTPException(422, { message: "Seule une écriture validée peut être contre-passée" });
      if (orig.transferGroupId) throw new HTTPException(422, { message: "Contre-passez chaque ligne d'un transfert séparément via l'administrateur" });
      const [already] = await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.reversesId, orig.id));
      if (already) throw new HTTPException(422, { message: "Déjà contre-passée" });
      const today = new Date().toISOString().slice(0, 10);
      const reference = await nextReference(tx, orig.parishId, Number(today.slice(0, 4)));
      const [row] = await tx.insert(transactions).values({
        ...orig, id: undefined as any, reference, direction: orig.direction === "in" ? "out" : "in",
        date: today, status: "brouillon", enteredBy: user.id, reversesId: orig.id,
        description: `Contre-passation de ${orig.reference}: ${comment}`, reconciledAt: null, createdAt: undefined as any,
      }).returning();
      await tx.insert(transactionEvents).values({ transactionId: row!.id, toStatus: "brouillon", actorId: user.id, comment });
      await audit(tx, { parishId: orig.parishId, actorId: user.id, action: "transaction.reverse", entity: "transaction", entityId: row!.id, before: { reverses: orig.id } });
      return row!;
    });
    return c.json(created, 201);
  });

async function act(c: any, action: TxAction, comment?: string) {
  const updated = await run(c, (tx) => applyAction(tx, actorOf(c), c.req.param("id"), action, comment));
  if (action === "reject") {
    const first = updated[0]!;
    const [author] = await c.get("db").select().from(users).where(eq(users.id, first.enteredBy));
    if (author) await safeSend(c.get("mailer"), [{ to: author.email, ...rejected({ reference: first.reference, reason: comment ?? "", appUrl: c.env.APP_URL }) }]);
  }
  return c.json(updated);
}

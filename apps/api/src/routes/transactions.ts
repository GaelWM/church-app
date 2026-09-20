import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, getTableColumns, gte, inArray, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { alias } from "drizzle-orm/pg-core";
import { accounts, categories, commitments, settings, transactionEvents, transactions, users, type Tx } from "@church/db";
import { batchActionSchema, can, isEditable, rejectSchema, transactionInputSchema, type TxAction } from "@church/shared";
import { rejected } from "@church/emails";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { accountBalance, getAccount, nextReference, usdEquivalent } from "../services/ledger";
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

type PieceMode = "manual" | "auto" | "mixed";
/** Parish setting `piece_number_mode` (value "manual" | "auto" | "mixed", or {mode}); defaults to mixed. */
async function pieceMode(tx: Tx, parishId: string): Promise<PieceMode> {
  const [s] = await tx.select().from(settings).where(and(eq(settings.parishId, parishId), eq(settings.key, "piece_number_mode")));
  const v = typeof s?.value === "object" && s.value !== null ? (s.value as any).mode : s?.value;
  return v === "manual" || v === "auto" || v === "mixed" ? v : "mixed";
}
/** manual: required; auto: always generated from the reference; mixed: optional, generated when blank. */
function resolvePiece(mode: PieceMode, input: string | undefined, reference: string): string {
  const v = input?.trim();
  if (mode === "manual" && !v) throw new HTTPException(422, { message: "N° de pièce requis" });
  if (mode === "auto") return reference;
  return v || reference;
}

async function assertOpenCommitment(tx: Tx, id: string, parishId: string) {
  const [m] = await tx.select().from(commitments).where(and(eq(commitments.id, id), eq(commitments.parishId, parishId)));
  if (!m || m.status !== "open") throw new HTTPException(422, { message: "Engagement invalide ou déjà clos" });
}

const filterSchema = z.object({
  kind: z.string().optional(), status: z.string().optional(), accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(), currency: z.string().optional(), enteredBy: z.string().uuid().optional(),
  from: z.string().optional(), to: z.string().optional(),
  validatorId: z.string().uuid().optional(), q: z.string().optional(),
});
type Filters = z.infer<typeof filterSchema>;

const ent = alias(users, "ent"), u1 = alias(users, "u1"), u2 = alias(users, "u2");
const withNames = { ...getTableColumns(transactions), enteredByName: ent.fullName, validator1Name: u1.fullName, validator2Name: u2.fullName };

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

export const transactionRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // List with filters (Recettes / Dépenses / Banques menus and the À valider inbox); names of initiator and validators included.
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
      return tx.select(withNames).from(transactions)
        .leftJoin(ent, eq(ent.id, transactions.enteredBy)).leftJoin(u1, eq(u1.id, transactions.validator1Id)).leftJoin(u2, eq(u2.id, transactions.validator2Id))
        .where(and(...w)).orderBy(desc(transactions.date), desc(transactions.createdAt)).limit(500);
    });
    return c.json(rows);
  })

  // Parish entry settings the forms need (piece number mode).
  .get("/config", async (c) => {
    const pid = c.get("parishId");
    const mode = pid ? await run(c, (tx) => pieceMode(tx, pid)) : "mixed";
    return c.json({ pieceNumberMode: mode });
  })

  // People who entered / validated entries (journal Initiateur and Validateur filters).
  .get("/people", async (c) => {
    const pid = c.get("parishId");
    const rows = await run(c, (tx) => tx.execute(sql`
      select u.id, u.full_name as "fullName",
        exists (select 1 from transactions t where t.entered_by = u.id ${pid ? sql`and t.parish_id = ${pid}::uuid` : sql``}) as initiator,
        exists (select 1 from transactions t where (t.validator1_id = u.id or t.validator2_id = u.id) ${pid ? sql`and t.parish_id = ${pid}::uuid` : sql``}) as validator
      from users u order by u.full_name`));
    return c.json([...rows].filter((r: any) => r.initiator || r.validator));
  })

  // Validated balance of one account (low-balance warning on dépense forms).
  .get("/balance", zValidator("query", z.object({ accountId: z.string().uuid() })), async (c) => {
    const { accountId } = c.req.valid("query");
    const out = await run(c, async (tx) => {
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
      if (!a) return null;
      return { accountId, currency: a.currency, balance: (await accountBalance(tx, accountId)).toString() };
    });
    if (!out) throw new HTTPException(404, { message: "Compte introuvable" });
    return c.json(out);
  })

  // Journal: chronological, running validated balance per account, server-side filters + search.
  // Response: { rows, summary, truncated }. summary is per currency, validated rows only (annulée / pending never counted):
  // opening = validated balance before `from`, in/out = period flows, recettes/depenses = same flows by kind (dashboard figures), closing = opening + in - out.
  .get("/journal", zValidator("query", filterSchema.passthrough()), async (c) => {
    const q = c.req.valid("query");
    const pid = c.get("parishId");
    const parishFilter = pid ? sql`and t.parish_id = ${pid}::uuid` : sql``;
    const LIMIT = 5000;
    const out = await run(c, async (tx) => {
      const rows = await tx.execute(sql`
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
        order by j.date, j.created_at, j.id limit ${LIMIT + 1}`);
      const summary = await tx.execute(sql`
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
      return {
        rows: [...rows].slice(0, LIMIT), truncated: rows.length > LIMIT,
        summary: [...summary].map((s: any) => ({ ...s, closing: (BigInt(s.opening) + BigInt(s.in) - BigInt(s.out)).toString() })),
      };
    });
    return c.json(out);
  })

  .get("/:id", async (c) => {
    const out = await run(c, async (tx) => {
      const [row] = await tx.select(withNames).from(transactions)
        .leftJoin(ent, eq(ent.id, transactions.enteredBy)).leftJoin(u1, eq(u1.id, transactions.validator1Id)).leftJoin(u2, eq(u2.id, transactions.validator2Id))
        .where(eq(transactions.id, c.req.param("id")));
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
      const documentNumber = resolvePiece(await pieceMode(tx, parishId), b.documentNumber, reference);
      if (b.commitmentId) {
        if (b.kind !== "depense") throw new HTTPException(422, { message: "Engagement réservé aux dépenses" });
        await assertOpenCommitment(tx, b.commitmentId, parishId);
      }
      const [row] = await tx.insert(transactions).values({
        parishId, reference, kind: b.kind, direction: b.kind === "recette" ? "in" : "out",
        accountId: b.accountId, categoryId: b.categoryId, currency, amountMinor: b.amountMinor,
        rateUsed: rate, amountUsdMinor: usd, date: b.date, status: "brouillon",
        description: b.description, beneficiary: b.beneficiary, documentNumber,
        subCategory: b.subCategory || null, commitmentId: b.commitmentId,
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
      if (b.commitmentId) {
        if (row.kind !== "depense") throw new HTTPException(422, { message: "Engagement réservé aux dépenses" });
        await assertOpenCommitment(tx, b.commitmentId, row.parishId);
      }
      let documentNumber = row.documentNumber;
      if (b.documentNumber !== undefined) documentNumber = resolvePiece(await pieceMode(tx, row.parishId), b.documentNumber, row.reference);
      const { rate, usd } = await usdEquivalent(tx, date, currency, amount);
      const [upd] = await tx.update(transactions).set({
        accountId, categoryId: b.categoryId ?? row.categoryId, date, currency, amountMinor: amount, rateUsed: rate,
        amountUsdMinor: usd, description: b.description ?? row.description, beneficiary: b.beneficiary ?? row.beneficiary,
        documentNumber, subCategory: b.subCategory !== undefined ? b.subCategory || null : row.subCategory,
        commitmentId: b.commitmentId ?? row.commitmentId, departmentId: b.departmentId ?? row.departmentId,
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

  // Batch actions for the À valider inboxes. Registered BEFORE "/:id/<action>" so "batch" is never read as an id.
  .post("/batch/:action", zValidator("json", batchActionSchema.extend({ comment: z.string().optional() })), async (c) => {
    const action = c.req.param("action") as TxAction;
    if (!["submit", "validate1", "validate2", "reject"].includes(action)) throw new HTTPException(404);
    const roles = c.get("roles");
    const allowed = action === "submit" ? can(roles, "transaction.create")
      : action === "validate1" ? can(roles, "transaction.validate1")
      : action === "validate2" ? can(roles, "transaction.validate2")
      : can(roles, "transaction.validate1") || can(roles, "transaction.validate2");
    if (!allowed) throw new HTTPException(403, { message: "Permission refusée" });
    const { ids, comment } = c.req.valid("json");
    const results = await run(c, (tx) => applyBatch(tx, actorOf(c), ids, action, comment));
    return c.json({ results });
  })

  // Workflow actions.
  .post("/:id/submit", requirePerm("transaction.create"), (c) => act(c, "submit"))
  .post("/:id/validate1", requirePerm("transaction.validate1"), (c) => act(c, "validate1"))
  .post("/:id/validate2", requirePerm("transaction.validate2"), (c) => act(c, "validate2"))
  .post("/:id/reject", zValidator("json", rejectSchema), async (c) => act(c, "reject", c.req.valid("json").comment))

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
        description: `Contre-passation de ${orig.reference}: ${comment}`, reconciledAt: null,
        validator1Id: null, validator1At: null, validator2Id: null, validator2At: null, commitmentId: null, createdAt: undefined as any,
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

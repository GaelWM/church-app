import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { accounts, commitments, engagementReleases, members, pledges, transactions, type Tx } from "@church/db";
import { CURRENCIES, ENGAGEMENT_TYPES, dueDate, pastDate } from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";
import { refreshCommitmentStatus } from "../services/workflow";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Sum of releases per engagement id. */
async function releaseTotals(tx: Tx, col: "pledgeId" | "commitmentId") {
  const c = engagementReleases[col];
  const rows = await tx.select({ id: c, s: sql<string>`sum(${engagementReleases.amountMinor})::text` }).from(engagementReleases).where(sql`${c} is not null`).groupBy(c);
  return new Map(rows.map((r) => [r.id!, BigInt(r.s)]));
}
const withReleased = <T extends { id: string; amountMinor: bigint }>(rows: T[], rel: Map<string, bigint>) =>
  rows.map((r) => ({ ...r, releasedMinor: rel.get(r.id) ?? 0n, remainingMinor: r.amountMinor - (rel.get(r.id) ?? 0n) }));

const uuid = z.string().uuid();
const amount = z.coerce.bigint().positive();

export const engagementRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Read-only member list for pledge/recette pickers (CRUD lives in /api/effectifs/members)
  .get("/members", async (c) => c.json(await run(c, (tx) => tx.select().from(members))))

  // Promesses de dons
  .get("/pledges", async (c) => c.json(await run(c, async (tx) => withReleased(await tx.select().from(pledges), await releaseTotals(tx, "pledgeId")))))
  .post("/pledges", requirePerm("transaction.create"), zValidator("json", z.object({
    memberId: uuid.optional(), donorName: z.string().optional(), categoryId: uuid, currency: z.enum(CURRENCIES), amountMinor: amount, dueDate: dueDate.optional(),
    type: z.enum(ENGAGEMENT_TYPES).default("autre"), beneficiary: z.string().trim().min(1).optional(),
  })), async (c) =>
    c.json(await run(c, async (tx) => {
      const b = c.req.valid("json");
      if (!b.memberId && !b.donorName) throw new HTTPException(422, { message: "Donateur requis" });
      const [p] = await tx.insert(pledges).values({ parishId: requireParish(c), ...b }).returning();
      await audit(tx, { parishId: p!.parishId, actorId: c.get("user").id, action: "pledge.create", entity: "pledge", entityId: p!.id, after: p });
      return p!;
    }), 201))

  // Engagements de dépenses
  .get("/commitments", async (c) => c.json(await run(c, async (tx) => withReleased(await tx.select().from(commitments), await releaseTotals(tx, "commitmentId")))))
  .post("/commitments", requirePerm("transaction.create"), zValidator("json", z.object({
    categoryId: uuid, payee: z.string().min(1), currency: z.enum(CURRENCIES), amountMinor: amount, dueDate: dueDate.optional(),
    type: z.enum(ENGAGEMENT_TYPES).default("autre"),
  })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [m] = await tx.insert(commitments).values({ parishId: requireParish(c), ...c.req.valid("json") }).returning();
      await audit(tx, { parishId: m!.parishId, actorId: c.get("user").id, action: "commitment.create", entity: "commitment", entityId: m!.id, after: m });
      return m!;
    }), 201))
  // Link a commitment to the dépense that paid it.
  .post("/commitments/:id/paid", requirePerm("transaction.create"), zValidator("json", z.object({ transactionId: uuid })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [m] = await tx.update(commitments).set({ status: "paid", transactionId: c.req.valid("json").transactionId }).where(eq(commitments.id, c.req.param("id"))).returning();
      await audit(tx, { parishId: m?.parishId, actorId: c.get("user").id, action: "commitment.paid", entity: "commitment", entityId: c.req.param("id"), after: m });
      return m;
    })))

  // Synthèse par type et devise: engagé / libéré / non libéré.
  .get("/summary", async (c) => c.json(await run(c, async (tx) => {
    const [ps, cs, pr, cr] = await Promise.all([
      tx.select().from(pledges), tx.select().from(commitments).where(ne(commitments.status, "cancelled")),
      releaseTotals(tx, "pledgeId"), releaseTotals(tx, "commitmentId"),
    ]);
    const agg = (rows: Array<{ id: string; type: string; currency: string; amountMinor: bigint }>, rel: Map<string, bigint>) => {
      const m = new Map<string, { type: string; currency: string; engagedMinor: bigint; releasedMinor: bigint }>();
      for (const r of rows) {
        const k = `${r.type}|${r.currency}`;
        const e = m.get(k) ?? { type: r.type, currency: r.currency, engagedMinor: 0n, releasedMinor: 0n };
        e.engagedMinor += r.amountMinor; e.releasedMinor += rel.get(r.id) ?? 0n;
        m.set(k, e);
      }
      return [...m.values()].map((e) => ({ ...e, remainingMinor: e.engagedMinor - e.releasedMinor }));
    };
    return { pledges: agg(ps, pr), commitments: agg(cs, cr) };
  })))

  // Libérations (historique par engagement)
  .get("/:kind{pledges|commitments}/:id/releases", async (c) =>
    c.json(await run(c, (tx) => tx.select().from(engagementReleases)
      .where(eq(c.req.param("kind") === "pledges" ? engagementReleases.pledgeId : engagementReleases.commitmentId, c.req.param("id")))
      .orderBy(desc(engagementReleases.date), desc(engagementReleases.createdAt)))))
  .post("/:kind{pledges|commitments}/:id/releases", requirePerm("transaction.create"), zValidator("json", z.object({
    date: pastDate, amountMinor: amount, accountId: uuid.optional(), transactionId: uuid.optional(), note: z.string().trim().max(500).optional(),
  })), async (c) => {
    const isPledge = c.req.param("kind") === "pledges";
    const b = c.req.valid("json");
    return c.json(await run(c, async (tx) => {
      const [eng] = isPledge ? await tx.select().from(pledges).where(eq(pledges.id, c.req.param("id"))) : await tx.select().from(commitments).where(eq(commitments.id, c.req.param("id")));
      if (!eng) throw new HTTPException(404, { message: "Engagement introuvable" });
      let accountId = b.accountId;
      if (accountId) {
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.parishId, eng.parishId)));
        if (!a) throw new HTTPException(422, { message: "Compte invalide" });
        if (a.currency !== eng.currency) throw new HTTPException(422, { message: "Devise du compte différente de l'engagement" });
      }
      if (b.transactionId) {
        const [t] = await tx.select().from(transactions).where(and(eq(transactions.id, b.transactionId), eq(transactions.parishId, eng.parishId)));
        if (!t) throw new HTTPException(422, { message: "Écriture introuvable" });
        if (t.currency !== eng.currency) throw new HTTPException(422, { message: "Devise de l'écriture différente de l'engagement" });
        const [dup] = await tx.select({ id: engagementReleases.id }).from(engagementReleases).where(eq(engagementReleases.transactionId, t.id));
        if (dup) throw new HTTPException(409, { message: "Cette écriture est déjà liée à une libération" });
        accountId ??= t.accountId;
      }
      const [r] = await tx.insert(engagementReleases).values({
        parishId: eng.parishId, pledgeId: isPledge ? eng.id : null, commitmentId: isPledge ? null : eng.id, date: b.date, currency: eng.currency,
        amountMinor: b.amountMinor, accountId, transactionId: b.transactionId, note: b.note, createdBy: c.get("user").id,
      }).returning();
      await audit(tx, { parishId: eng.parishId, actorId: c.get("user").id, action: "engagement.release.create", entity: "engagement_release", entityId: r!.id, after: r });
      if (!isPledge) await refreshCommitmentStatus(tx, eng.id);
      return r!;
    }), 201);
  })
  .post("/releases/:id/file", requirePerm("transaction.create"), async (c) => {
    const form = await c.req.formData();
    const file = form.get("file") as unknown as File | string | null;
    if (!file || typeof file === "string") throw new HTTPException(400, { message: "Fichier manquant" });
    if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Fichier trop volumineux (8 Mo max)" });
    if (!ALLOWED.includes(file.type)) throw new HTTPException(415, { message: "Type de fichier non autorisé" });
    return c.json(await run(c, async (tx) => {
      const [r] = await tx.select().from(engagementReleases).where(eq(engagementReleases.id, c.req.param("id")));
      if (!r) throw new HTTPException(404, { message: "Libération introuvable" });
      const key = `${r.parishId}/releases/${crypto.randomUUID()}`;
      await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      const [u] = await tx.update(engagementReleases).set({ r2Key: key, filename: file.name }).where(eq(engagementReleases.id, r.id)).returning();
      await audit(tx, { parishId: r.parishId, actorId: c.get("user").id, action: "engagement.release.attach", entity: "engagement_release", entityId: r.id, before: { filename: r.filename }, after: { filename: file.name } });
      return u!;
    }));
  })
  .get("/releases/:id/file", async (c) => {
    const r = await run(c, async (tx) => (await tx.select().from(engagementReleases).where(eq(engagementReleases.id, c.req.param("id"))))[0]);
    if (!r?.r2Key) throw new HTTPException(404);
    const obj = await c.env.FILES.get(r.r2Key);
    if (!obj) throw new HTTPException(404);
    return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
  });

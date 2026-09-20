import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { categories, periods, transactionEvents, transactions, type Tx } from "@church/db";
import { pastDate, rateToScaled, toUsdMinor } from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { getAccount, nextReference, rateOn, usdEquivalent } from "../services/ledger";
import { run } from "../services/run";

const uuid = z.string().uuid();
const date = pastDate;
const amount = z.coerce.bigint().positive();

const bankOpSchema = z.discriminatedUnion("type", [
  // Two-leg moves between accounts of the same currency.
  z.object({ type: z.enum(["versement", "retrait", "virement"]), fromAccountId: uuid, toAccountId: uuid, date, amountMinor: amount, description: z.string().optional() }),
  // Currency exchange at the actual rate obtained ("1 USD = X CDF").
  z.object({ type: z.literal("change"), fromAccountId: uuid, toAccountId: uuid, date, amountMinor: amount, actualRateCdfPerUsd: z.string().regex(/^\d+(\.\d{1,4})?$/), description: z.string().optional() }),
  // Single-leg bank movements.
  z.object({ type: z.enum(["frais", "interets"]), accountId: uuid, date, amountMinor: amount, description: z.string().optional(),
    // Frais: tenue de compte / retrait bancaire / retrait mobile money each have their own category.
    feeType: z.enum(["tenue_compte", "retrait_bancaire", "retrait_mobile_money"]).optional() }),
]);

const CAT_NAME: Record<string, string> = {
  versement: "Versement (caisse vers banque)", retrait: "Retrait (banque vers caisse)", virement: "Virement entre comptes",
  change: "Opération de change", frais: "Frais bancaires et commissions", interets: "Intérêts créditeurs",
};

const FEE_CAT_NAME: Record<string, string> = {
  tenue_compte: "Frais de tenue de compte bancaire", retrait_bancaire: "Frais de retrait bancaire",
  retrait_mobile_money: "Frais de retrait Mobile Money",
};

async function bankCategory(tx: Tx, type: string, feeType?: string) {
  const name = (feeType && FEE_CAT_NAME[feeType]) || CAT_NAME[type]!;
  const [cat] = await tx.select().from(categories).where(and(eq(categories.kind, "banque"), eq(categories.name, name)));
  if (!cat) throw new HTTPException(500, { message: "Catégories bancaires non initialisées" });
  return cat.id;
}

export const bankingRoutes = new Hono<AppEnv>()
  .use(parishScope)

  .post("/operations", requirePerm("transaction.create"), zValidator("json", bankOpSchema), async (c) => {
    const b = c.req.valid("json");
    const parishId = requireParish(c);
    const user = c.get("user");
    const out = await run(c, async (tx) => {
      const categoryId = await bankCategory(tx, b.type, "feeType" in b ? b.feeType : undefined);
      const year = Number(b.date.slice(0, 4));
      const base = { parishId, categoryId, date: b.date, status: "brouillon", enteredBy: user.id, description: b.description ?? null };
      const rows: Array<typeof transactions.$inferInsert> = [];

      if ("accountId" in b) {
        const acct = await getAccount(tx, b.accountId, parishId);
        if (acct.type === "caisse") throw new HTTPException(422, { message: "Compte bancaire ou mobile money requis" });
        const currency = acct.currency as "CDF" | "USD";
        const { rate, usd } = await usdEquivalent(tx, b.date, currency, b.amountMinor);
        // Fees show as a dépense, interest as a recette.
        rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: b.type === "frais" ? "depense" : "recette",
          direction: b.type === "frais" ? "out" : "in", accountId: acct.id, currency, amountMinor: b.amountMinor, rateUsed: rate, amountUsdMinor: usd });
      } else {
        const from = await getAccount(tx, b.fromAccountId, parishId);
        const to = await getAccount(tx, b.toAccountId, parishId);
        if (from.id === to.id) throw new HTTPException(422, { message: "Comptes identiques" });
        const group = crypto.randomUUID();
        const fromCur = from.currency as "CDF" | "USD";
        const toCur = to.currency as "CDF" | "USD";
        if (b.type === "change") {
          if (fromCur === toCur) throw new HTTPException(422, { message: "Un change requiert deux devises" });
          const actual = b.actualRateCdfPerUsd;
          // Amount received = amount sent converted at the actual rate (exact integer maths).
          const scaled = rateToScaled(actual);
          const received = fromCur === "USD" ? (b.amountMinor * scaled + 5_000n) / 10_000n : (b.amountMinor * 10_000n + scaled / 2n) / scaled;
          const official = await rateOn(tx, b.date);
          // USD equivalents use the OFFICIAL rate so the difference on each leg is the change gain/loss.
          rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: "change", direction: "out", accountId: from.id, currency: fromCur,
            amountMinor: b.amountMinor, rateUsed: actual, amountUsdMinor: toUsdMinor(b.amountMinor, fromCur, official), transferGroupId: group });
          rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: "change", direction: "in", accountId: to.id, currency: toCur,
            amountMinor: received, rateUsed: actual, amountUsdMinor: toUsdMinor(received, toCur, official), transferGroupId: group });
        } else {
          if (fromCur !== toCur) throw new HTTPException(422, { message: "Devises différentes: utilisez un change" });
          if (b.type === "versement" && !(from.type === "caisse" && to.type !== "caisse")) throw new HTTPException(422, { message: "Versement: caisse vers banque" });
          if (b.type === "retrait" && !(to.type === "caisse" && from.type !== "caisse")) throw new HTTPException(422, { message: "Retrait: banque vers caisse" });
          const { rate, usd } = await usdEquivalent(tx, b.date, fromCur, b.amountMinor);
          for (const [dir, acct] of [["out", from], ["in", to]] as const)
            rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: "transfert", direction: dir, accountId: acct.id,
              currency: fromCur, amountMinor: b.amountMinor, rateUsed: rate, amountUsdMinor: usd, transferGroupId: group });
        }
      }
      const inserted = await tx.insert(transactions).values(rows).returning();
      await tx.insert(transactionEvents).values(inserted.map((r) => ({ transactionId: r.id, toStatus: "brouillon", actorId: user.id })));
      await audit(tx, { parishId, actorId: user.id, action: `bank.${b.type}`, entity: "transaction", entityId: inserted[0]!.id, after: inserted });
      return inserted;
    });
    return c.json(out, 201);
  })

  // Rapprochement bancaire: lines of one account for a month, matched or not.
  .get("/reconciliation", zValidator("query", z.object({ accountId: uuid, year: z.coerce.number(), month: z.coerce.number() })), async (c) => {
    const { accountId, year, month } = c.req.valid("query");
    const rows = await run(c, (tx) => tx.select().from(transactions).where(and(
      eq(transactions.accountId, accountId), eq(transactions.status, "validee"),
      sql`extract(year from ${transactions.date}) = ${year}`, sql`extract(month from ${transactions.date}) = ${month}`)));
    return c.json({ matched: rows.filter((r) => r.reconciledAt), unmatched: rows.filter((r) => !r.reconciledAt) });
  })
  .post("/reconciliation", requirePerm("reconcile"), zValidator("json", z.object({ ids: z.array(uuid).min(1), matched: z.boolean() })), async (c) => {
    const { ids, matched } = c.req.valid("json");
    await run(c, async (tx) => {
      await tx.update(transactions).set({ reconciledAt: matched ? new Date() : null })
        .where(and(inArray(transactions.id, ids), eq(transactions.status, "validee")));
      await audit(tx, { parishId: c.get("parishId"), actorId: c.get("user").id, action: matched ? "reconcile.match" : "reconcile.unmatch", entity: "transaction", after: { ids } });
    });
    return c.json({ ok: true });
  })

  // Clôture mensuelle: after closing, nothing can be back-dated into the month.
  .get("/periods", async (c) => c.json(await run(c, (tx) => tx.select().from(periods))))
  .post("/periods/close", requirePerm("period.close"), zValidator("json", z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) })), async (c) => {
    const { year, month } = c.req.valid("json");
    const parishId = requireParish(c);
    await run(c, async (tx) => {
      const pending = await tx.select({ n: sql<number>`count(*)::int` }).from(transactions).where(and(
        eq(transactions.parishId, parishId), inArray(transactions.status, ["brouillon", "soumise", "validee1"]),
        sql`extract(year from ${transactions.date}) = ${year}`, sql`extract(month from ${transactions.date}) = ${month}`));
      if (pending[0]!.n > 0) throw new HTTPException(422, { message: `${pending[0]!.n} écriture(s) en attente dans ce mois` });
      await tx.insert(periods).values({ parishId, year, month, closedBy: c.get("user").id, closedAt: new Date() })
        .onConflictDoUpdate({ target: [periods.parishId, periods.year, periods.month], set: { closedBy: c.get("user").id, closedAt: new Date() } });
      await audit(tx, { parishId, actorId: c.get("user").id, action: "period.close", entity: "period", entityId: `${year}-${month}` });
    });
    return c.json({ ok: true });
  });

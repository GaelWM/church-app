import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { commitments, engagementReleases, transactionEvents, transactions, type Tx } from "@church/db";
import { transition, WorkflowError, type Role, type TxAction, type TxStatus } from "@church/shared";
import { audit } from "./audit";
import { accountBalance } from "./ledger";

export type Actor = { id: string; roles: Role[] };

const NEXT_EVENT: Record<TxAction, string> = { submit: "submit", validate1: "validate1", validate2: "validate2", reject: "reject" };

/**
 * Apply a workflow action to a transaction (and, for transfers/changes, to every
 * line in its transfer group so the two legs always move together).
 */
export async function applyAction(tx: Tx, actor: Actor, id: string, action: TxAction, comment?: string) {
  const [row] = await tx.select().from(transactions).where(eq(transactions.id, id));
  if (!row) throw new HTTPException(404, { message: "Écriture introuvable" });
  const rows = row.transferGroupId
    ? await tx.select().from(transactions).where(eq(transactions.transferGroupId, row.transferGroupId))
    : [row];
  rows.sort((a) => (a.direction === "out" ? -1 : 1)); // outflows first so overdraft checks see them

  const updated: typeof rows = [];
  for (const r of rows) {
    let next: TxStatus;
    try {
      next = transition({
        status: r.status as TxStatus, action, actorId: actor.id, enteredBy: r.enteredBy,
        actorRoles: actor.roles, comment,
      });
    } catch (e) {
      if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
      throw e;
    }
    if (next === "validee" && r.direction === "out") {
      await tx.execute(sql`select 1 from accounts where id = ${r.accountId} for update`);
      if ((await accountBalance(tx, r.accountId)) - r.amountMinor < 0n)
        throw new HTTPException(422, { message: `Solde insuffisant pour valider ${r.reference}` });
    }
    const now = new Date();
    const stamp = next === "validee1" ? { validator1Id: actor.id, validator1At: now }
      : next === "validee" ? { validator2Id: actor.id, validator2At: now } : {};
    await tx.update(transactions).set({ status: next, ...stamp }).where(eq(transactions.id, r.id));
    await tx.insert(transactionEvents).values({
      transactionId: r.id, fromStatus: r.status, toStatus: next, actorId: actor.id, comment: comment ?? null,
    });
    await audit(tx, {
      parishId: r.parishId, actorId: actor.id, action: `transaction.${NEXT_EVENT[action]}`,
      entity: "transaction", entityId: r.id, before: { status: r.status }, after: { status: next, comment },
    });
    if (next === "validee") await autoRelease(tx, actor, r);
    updated.push({ ...r, status: next });
  }
  return updated;
}

export async function applyBatch(tx: Tx, actor: Actor, ids: string[], action: TxAction, comment?: string) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      await applyAction(tx, actor, id, action, comment);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof HTTPException ? e.message : "Erreur" });
    }
  }
  return results;
}


/** A validated dépense linked to a commitment (or recette linked to a pledge) is a libération; idempotent per transaction. */
async function autoRelease(tx: Tx, actor: Actor, r: typeof transactions.$inferSelect) {
  if (!r.commitmentId && !r.pledgeId) return;
  const [dup] = await tx.select({ id: engagementReleases.id }).from(engagementReleases).where(eq(engagementReleases.transactionId, r.id));
  if (dup) return;
  const [rel] = await tx.insert(engagementReleases).values({
    parishId: r.parishId, pledgeId: r.commitmentId ? null : r.pledgeId, commitmentId: r.commitmentId, date: r.date, currency: r.currency,
    amountMinor: r.amountMinor, accountId: r.accountId, transactionId: r.id, note: `Auto : ${r.reference}`, createdBy: actor.id,
  }).returning();
  await audit(tx, { parishId: r.parishId, actorId: actor.id, action: "engagement.release.auto", entity: "engagement_release", entityId: rel!.id, after: rel });
  if (r.commitmentId) await refreshCommitmentStatus(tx, r.commitmentId);
}

/** Commitment becomes `paid` when libéré >= engagé (and back to `open` if it no longer is). */
export async function refreshCommitmentStatus(tx: Tx, commitmentId: string) {
  const [c] = await tx.select().from(commitments).where(eq(commitments.id, commitmentId));
  if (!c || c.status === "cancelled") return;
  const [sum] = await tx.select({ s: sql<string>`coalesce(sum(${engagementReleases.amountMinor}), 0)::text` }).from(engagementReleases).where(eq(engagementReleases.commitmentId, commitmentId));
  const status = BigInt(sum!.s) >= c.amountMinor ? "paid" : "open";
  if (status !== c.status) await tx.update(commitments).set({ status }).where(eq(commitments.id, commitmentId));
}

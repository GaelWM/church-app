import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { audit } from "../../services/audit";
import { refreshCommitmentStatus } from "../../services/workflow";
import type { Files } from "../attachments/upload";
import type { CommitmentInput, PledgeInput, ReleaseInput } from "./engagements.dto";
import * as repo from "./engagements.repo";

/** Who is acting, and on which parish: everything the service needs from the request. */
export type Actor = { userId: string; parishId: string };

const withReleased = <T extends { id: string; amountMinor: bigint }>(rows: T[], rel: Map<string, bigint>) =>
  rows.map((r) => ({ ...r, releasedMinor: rel.get(r.id) ?? 0n, remainingMinor: r.amountMinor - (rel.get(r.id) ?? 0n) }));

export const listMembers = repo.listMembers;

export async function listPledges(tx: Tx) {
  return withReleased(await repo.listPledges(tx), await repo.releaseTotals(tx, "pledgeId"));
}

export async function createPledge(tx: Tx, actor: Actor, b: PledgeInput) {
  if (!b.memberId && !b.donorName) throw new HTTPException(422, { message: "Donateur requis" });
  const p = await repo.insertPledge(tx, { parishId: actor.parishId, ...b });
  await audit(tx, { parishId: p.parishId, actorId: actor.userId, action: "pledge.create", entity: "pledge", entityId: p.id, after: p });
  return p;
}

export async function listCommitments(tx: Tx) {
  return withReleased(await repo.listCommitments(tx), await repo.releaseTotals(tx, "commitmentId"));
}

export async function createCommitment(tx: Tx, actor: Actor, b: CommitmentInput) {
  const m = await repo.insertCommitment(tx, { parishId: actor.parishId, ...b });
  await audit(tx, { parishId: m.parishId, actorId: actor.userId, action: "commitment.create", entity: "commitment", entityId: m.id, after: m });
  return m;
}

/** Link a commitment to the dépense that paid it. */
export async function markCommitmentPaid(tx: Tx, actor: { userId: string }, id: string, transactionId: string) {
  const m = await repo.markCommitmentPaid(tx, id, transactionId);
  await audit(tx, { parishId: m?.parishId, actorId: actor.userId, action: "commitment.paid", entity: "commitment", entityId: id, after: m });
  return m;
}

/** Synthèse par type et devise: engagé / libéré / non libéré. */
export async function summary(tx: Tx) {
  const [ps, cs, pr, cr] = await Promise.all([
    repo.listPledges(tx), repo.listActiveCommitments(tx),
    repo.releaseTotals(tx, "pledgeId"), repo.releaseTotals(tx, "commitmentId"),
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
}

export const listReleases = repo.listReleases;

export async function createRelease(tx: Tx, actor: { userId: string }, kind: repo.Kind, id: string, b: ReleaseInput) {
  const isPledge = kind === "pledges";
  const eng = await repo.findEngagement(tx, isPledge, id);
  if (!eng) throw new HTTPException(404, { message: "Engagement introuvable" });
  let accountId = b.accountId;
  if (accountId) {
    const a = await repo.findAccountInParish(tx, accountId, eng.parishId);
    if (!a) throw new HTTPException(422, { message: "Compte invalide" });
    if (a.currency !== eng.currency) throw new HTTPException(422, { message: "Devise du compte différente de l'engagement" });
  }
  if (b.transactionId) {
    const t = await repo.findTransactionInParish(tx, b.transactionId, eng.parishId);
    if (!t) throw new HTTPException(422, { message: "Écriture introuvable" });
    if (t.currency !== eng.currency) throw new HTTPException(422, { message: "Devise de l'écriture différente de l'engagement" });
    const dup = await repo.findReleaseByTransaction(tx, t.id);
    if (dup) throw new HTTPException(409, { message: "Cette écriture est déjà liée à une libération" });
    accountId ??= t.accountId;
  }
  const r = await repo.insertRelease(tx, {
    parishId: eng.parishId, pledgeId: isPledge ? eng.id : null, commitmentId: isPledge ? null : eng.id, date: b.date, currency: eng.currency,
    amountMinor: b.amountMinor, accountId, transactionId: b.transactionId, note: b.note, createdBy: actor.userId,
  });
  await audit(tx, { parishId: eng.parishId, actorId: actor.userId, action: "engagement.release.create", entity: "engagement_release", entityId: r.id, after: r });
  if (!isPledge) await refreshCommitmentStatus(tx, eng.id);
  return r;
}

export async function attachReleaseFile(tx: Tx, actor: { userId: string }, files: Files, id: string, file: File) {
  const r = await repo.findRelease(tx, id);
  if (!r) throw new HTTPException(404, { message: "Libération introuvable" });
  const key = `${r.parishId}/releases/${crypto.randomUUID()}`;
  await files.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const u = await repo.setReleaseFile(tx, r.id, key, file.name);
  await audit(tx, { parishId: r.parishId, actorId: actor.userId, action: "engagement.release.attach", entity: "engagement_release", entityId: r.id, before: { filename: r.filename }, after: { filename: file.name } });
  return u;
}

/** Returns the R2 key of a release's attached file (404 when none). */
export async function getReleaseFileKey(tx: Tx, id: string) {
  const r = await repo.findRelease(tx, id);
  if (!r?.r2Key) throw new HTTPException(404);
  return r.r2Key;
}

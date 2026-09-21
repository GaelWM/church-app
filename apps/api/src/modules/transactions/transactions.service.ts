import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { can, isEditable, type Role, type TxAction } from "@church/shared";
import { audit } from "../../services/audit";
import { accountBalance, getAccount, nextReference, usdEquivalent } from "../../services/ledger";
import { applyAction, applyBatch } from "../../services/workflow";
import type { BalanceQuery, BatchBody, Filters, TransactionCreateInput, TransactionPatchInput } from "./transactions.dto";
import * as repo from "./transactions.repo";

/** Who is acting; parishId is only guaranteed (requireParish) for create. */
export type Actor = { userId: string; parishId?: string; roles: Role[] };

async function loadCategory(tx: Tx, id: string, kind: string) {
  const cat = await repo.findCategory(tx, id);
  if (!cat || !cat.active || cat.kind !== kind) throw new HTTPException(422, { message: "Catégorie invalide" });
  return cat;
}

type PieceMode = "manual" | "auto" | "mixed";
/** Parish setting `piece_number_mode` (value "manual" | "auto" | "mixed", or {mode}); defaults to mixed. */
export async function pieceMode(tx: Tx, parishId: string): Promise<PieceMode> {
  const s = await repo.findPieceModeSetting(tx, parishId);
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
  const m = await repo.findCommitment(tx, id, parishId);
  if (!m || m.status !== "open") throw new HTTPException(422, { message: "Engagement invalide ou déjà clos" });
}

export const list = (tx: Tx, actor: Actor, q: Filters) => repo.list(tx, q, actor.parishId);

export const listPeople = async (tx: Tx, actor: Actor) =>
  [...(await repo.listPeople(tx, actor.parishId))].filter((r: any) => r.initiator || r.validator);

export async function getBalance(tx: Tx, { accountId }: BalanceQuery) {
  const a = await repo.findAccount(tx, accountId);
  if (!a) throw new HTTPException(404, { message: "Compte introuvable" });
  return { accountId, currency: a.currency, balance: (await accountBalance(tx, accountId)).toString() };
}

/**
 * Journal: chronological, running validated balance per account, server-side filters + search.
 * Response: { rows, summary, truncated }. summary is per currency, validated rows only (annulée / pending never counted):
 * opening = validated balance before `from`, in/out = period flows, recettes/depenses = same flows by kind (dashboard figures), closing = opening + in - out.
 */
export async function journal(tx: Tx, actor: Actor, q: Filters) {
  const LIMIT = 5000;
  const rows = await repo.journalRows(tx, q, actor.parishId, LIMIT);
  const summary = await repo.journalSummary(tx, q, actor.parishId);
  return {
    rows: [...rows].slice(0, LIMIT), truncated: rows.length > LIMIT,
    summary: [...summary].map((s: any) => ({ ...s, closing: (BigInt(s.opening) + BigInt(s.in) - BigInt(s.out)).toString() })),
  };
}

export async function getDetail(tx: Tx, id: string) {
  const out = await repo.findDetail(tx, id);
  if (!out) throw new HTTPException(404, { message: "Écriture introuvable" });
  return { ...out, events: out.events.map((x) => ({ ...x.e, actorName: x.actor })) };
}

/** Create a recette or dépense (always starts as Brouillon). */
export async function create(tx: Tx, actor: Actor & { parishId: string }, b: TransactionCreateInput) {
  const { parishId, userId } = actor;
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
  const row = await repo.insertTransaction(tx, {
    parishId, reference, kind: b.kind, direction: b.kind === "recette" ? "in" : "out",
    accountId: b.accountId, categoryId: b.categoryId, currency, amountMinor: b.amountMinor,
    rateUsed: rate, amountUsdMinor: usd, date: b.date, status: "brouillon",
    description: b.description, beneficiary: b.beneficiary, documentNumber,
    subCategory: b.subCategory || null, commitmentId: b.commitmentId,
    departmentId: b.departmentId, memberId: b.memberId, pledgeId: b.pledgeId, enteredBy: userId,
  });
  await repo.insertDraftEvent(tx, row.id, userId);
  await audit(tx, { parishId, actorId: userId, action: "transaction.create", entity: "transaction", entityId: row.id, after: row });
  return row;
}

/** Edit own draft / rejected entry. */
export async function update(tx: Tx, actor: Actor, id: string, b: TransactionPatchInput) {
  const row = await repo.findById(tx, id);
  if (!row) throw new HTTPException(404, { message: "Écriture introuvable" });
  if (row.enteredBy !== actor.userId || !isEditable(row.status as any) || row.transferGroupId)
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
  const upd = await repo.updateTransaction(tx, row.id, {
    accountId, categoryId: b.categoryId ?? row.categoryId, date, currency, amountMinor: amount, rateUsed: rate,
    amountUsdMinor: usd, description: b.description ?? row.description, beneficiary: b.beneficiary ?? row.beneficiary,
    documentNumber, subCategory: b.subCategory !== undefined ? b.subCategory || null : row.subCategory,
    commitmentId: b.commitmentId ?? row.commitmentId, departmentId: b.departmentId ?? row.departmentId,
    memberId: b.memberId ?? row.memberId, pledgeId: b.pledgeId ?? row.pledgeId,
  });
  await audit(tx, { parishId: row.parishId, actorId: actor.userId, action: "transaction.update", entity: "transaction", entityId: row.id, before: row, after: upd });
  return upd;
}

/** Delete own draft before submission. */
export async function remove(tx: Tx, actor: Actor, id: string) {
  const row = await repo.findById(tx, id);
  if (!row || row.enteredBy !== actor.userId || row.status !== "brouillon")
    throw new HTTPException(422, { message: "Suppression impossible" });
  const ids = row.transferGroupId ? await repo.idsInTransferGroup(tx, row.transferGroupId) : [row.id];
  await repo.deleteWithEvents(tx, ids);
  await audit(tx, { parishId: row.parishId, actorId: actor.userId, action: "transaction.delete", entity: "transaction", entityId: row.id, before: row });
}

const BATCH_ACTIONS = ["submit", "validate1", "validate2", "reject"];

/** Throws 404 for an unknown action, 403 when the roles do not allow it. Runs before the transaction opens. */
export function assertBatchAllowed(roles: Role[], action: TxAction) {
  if (!BATCH_ACTIONS.includes(action)) throw new HTTPException(404);
  const allowed = action === "submit" ? can(roles, "transaction.create")
    : action === "validate1" ? can(roles, "transaction.validate1")
    : action === "validate2" ? can(roles, "transaction.validate2")
    : can(roles, "transaction.validate1") || can(roles, "transaction.validate2");
  if (!allowed) throw new HTTPException(403, { message: "Permission refusée" });
}

export const batch = (tx: Tx, actor: Actor, action: TxAction, { ids, comment }: BatchBody) =>
  applyBatch(tx, { id: actor.userId, roles: actor.roles }, ids, action, comment);

export const act = (tx: Tx, actor: Actor, id: string, action: TxAction, comment?: string) =>
  applyAction(tx, { id: actor.userId, roles: actor.roles }, id, action, comment);

/** Contre-passation: reversing entry linked to a validated original. */
export async function reverse(tx: Tx, actor: Actor, id: string, comment: string) {
  const orig = await repo.findById(tx, id);
  if (!orig || orig.status !== "validee") throw new HTTPException(422, { message: "Seule une écriture validée peut être contre-passée" });
  if (orig.transferGroupId) throw new HTTPException(422, { message: "Contre-passez chaque ligne d'un transfert séparément via l'administrateur" });
  if (await repo.findReversalOf(tx, orig.id)) throw new HTTPException(422, { message: "Déjà contre-passée" });
  const today = new Date().toISOString().slice(0, 10);
  const reference = await nextReference(tx, orig.parishId, Number(today.slice(0, 4)));
  const row = await repo.insertTransaction(tx, {
    ...orig, id: undefined as any, reference, direction: orig.direction === "in" ? "out" : "in",
    date: today, status: "brouillon", enteredBy: actor.userId, reversesId: orig.id,
    description: `Contre-passation de ${orig.reference}: ${comment}`, reconciledAt: null,
    validator1Id: null, validator1At: null, validator2Id: null, validator2At: null, commitmentId: null, createdAt: undefined as any,
  });
  await repo.insertDraftEvent(tx, row.id, actor.userId, comment);
  await audit(tx, { parishId: orig.parishId, actorId: actor.userId, action: "transaction.reverse", entity: "transaction", entityId: row.id, before: { reverses: orig.id } });
  return row;
}

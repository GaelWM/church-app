import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import {
  can, changeRequestTransition, MODIFIABLE_TX_FIELDS, WorkflowError, type ChangeRequestAction, type ChangeRequestStatus,
} from "@church/shared";
import { audit } from "../../services/audit";
import type { ChangeRequestInput, ListQuery } from "./change-requests.dto";
import * as repo from "./change-requests.repo";

/** Who is acting: id, their roles and the current parish (null in the consolidated view). */
export type Actor = { userId: string; parishId: string | null; roles: any[] };

const OPEN = ["en_attente_tresorier", "approuvee_n1", "approuvee_n2"];

const flat = (x: repo.RequestRow) => ({
  ...x.r, txReference: x.txReference, txDescription: x.txDescription, txAmountMinor: x.txAmountMinor, txCurrency: x.txCurrency,
  txStatus: x.txStatus, txDate: x.txDate, requesterName: x.requesterName, tresorierName: x.tresorierName, pasteurName: x.pasteurName,
});

const canReadAll = (actor: Actor) => can(actor.roles as any, "transaction.readAll");

async function validateChanges(tx: Tx, row: repo.TransactionRow, changes: Record<string, unknown>) {
  const grouped = !!row.transferGroupId;
  if (grouped && (changes.categoryId !== undefined || changes.departmentId !== undefined))
    throw new HTTPException(422, { message: "Catégorie et département non modifiables sur un transfert" });
  if (changes.categoryId) {
    const cat = await repo.findCategory(tx, changes.categoryId as string);
    if (!cat || !cat.active || cat.kind !== row.kind) throw new HTTPException(422, { message: "Catégorie invalide" });
    if (cat.requiresDepartment && !(("departmentId" in changes ? changes.departmentId : row.departmentId)))
      throw new HTTPException(422, { message: "Département requis" });
  } else if (changes.categoryId === null) throw new HTTPException(422, { message: "Catégorie obligatoire" });
  if (changes.departmentId) {
    const d = await repo.findDepartmentInParish(tx, changes.departmentId as string, row.parishId);
    if (!d) throw new HTTPException(422, { message: "Département invalide" });
  }
}

/** Runs inside the approve2 DB transaction: applies the approved change (and to every transfer leg). */
async function execute(tx: Tx, req: repo.ChangeRequestRow, actorId: string) {
  const row = await repo.lockTransaction(tx, req.transactionId);
  if (!row) throw new HTTPException(404, { message: "Écriture introuvable" });
  if (row.status !== "validee") throw new HTTPException(422, { message: "L'écriture n'est plus validée" });
  const rows = row.transferGroupId ? await repo.listGroupRows(tx, row.transferGroupId) : [row];
  await repo.enableChangeRequestExec(tx);
  const changes = (req.proposedChanges ?? {}) as Record<string, unknown>;
  if (req.kind === "modification") await validateChanges(tx, row, changes);
  for (const r of rows) {
    if (r.status !== "validee") throw new HTTPException(422, { message: "L'écriture n'est plus validée" });
    if (req.kind === "annulation") {
      await repo.cancelTransaction(tx, r.id);
      await repo.insertTransactionEvent(tx, { transactionId: r.id, fromStatus: r.status, toStatus: "annulee", actorId, comment: req.reason });
      await audit(tx, {
        parishId: r.parishId, actorId, action: "transaction.cancel", entity: "transaction", entityId: r.id,
        before: { status: r.status }, after: { status: "annulee", reason: req.reason, changeRequest: req.reference },
      });
    } else {
      const patch = Object.fromEntries(MODIFIABLE_TX_FIELDS.filter((f) => f in changes).map((f) => [f, changes[f]]));
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (r as any)[k]]));
      await repo.patchTransaction(tx, r.id, patch);
      await repo.insertTransactionEvent(tx, { transactionId: r.id, fromStatus: r.status, toStatus: r.status, actorId, comment: `Modification approuvée (${req.reference}): ${req.reason}` });
      await audit(tx, {
        parishId: r.parishId, actorId, action: "transaction.modify", entity: "transaction", entityId: r.id,
        before, after: { ...patch, reason: req.reason, changeRequest: req.reference },
      });
    }
  }
}

export async function createRequest(tx: Tx, actor: Actor, parishId: string, b: ChangeRequestInput) {
  const row = await repo.lockTransaction(tx, b.transactionId);
  if (!row || row.parishId !== parishId) throw new HTTPException(404, { message: "Écriture introuvable" });
  if (row.status === "annulee") throw new HTTPException(422, { message: "Écriture déjà annulée" });
  if (row.status !== "validee") throw new HTTPException(422, { message: "Seule une écriture validée nécessite une demande" });
  const group = row.transferGroupId ? await repo.listGroupIds(tx, row.transferGroupId) : [row.id];
  const open = await repo.findOpenRequest(tx, group, OPEN);
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
  const reference = await repo.nextRequestReference(tx, parishId, year);
  const req = await repo.insertRequest(tx, {
    parishId, reference, transactionId: row.id, kind: b.kind, reason: b.reason,
    proposedChanges: proposed, oldValues: old, requesterId: actor.userId,
  });
  await repo.insertEvent(tx, { requestId: req.id, toStatus: "en_attente_tresorier", actorId: actor.userId, comment: b.reason });
  await audit(tx, { parishId, actorId: actor.userId, action: "change_request.create", entity: "change_request", entityId: req.id, after: req });
  return req;
}

export async function listRequests(tx: Tx, actor: Actor, query: ListQuery) {
  const all = canReadAll(actor);
  if (!all && !can(actor.roles as any, "change.request")) throw new HTTPException(403, { message: "Permission refusée" });
  const rows = await repo.listRequests(tx, {
    parishId: actor.parishId, status: query.status,
    requesterId: query.mine || !all ? actor.userId : undefined,
  });
  return rows.map(flat);
}

export async function getRequest(tx: Tx, actor: Actor, id: string) {
  const x = await repo.findRequestView(tx, id);
  if (!x || (!canReadAll(actor) && x.r.requesterId !== actor.userId)) throw new HTTPException(404, { message: "Demande introuvable" });
  const events = await repo.listEvents(tx, x.r.id);
  return { ...flat(x), events: events.map((e) => ({ ...e.e, actorName: e.actor })) };
}

export async function decide(tx: Tx, actor: Actor, id: string, action: ChangeRequestAction, comment?: string) {
  const req = await repo.lockRequest(tx, id);
  if (!req) throw new HTTPException(404, { message: "Demande introuvable" });
  let next: ChangeRequestStatus;
  try {
    next = changeRequestTransition({
      status: req.status as ChangeRequestStatus, action, actorId: actor.userId, requesterId: req.requesterId,
      actorRoles: actor.roles, comment,
    });
  } catch (e) {
    if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
  const now = new Date();
  const stamp = action === "approve1" ? { tresorierId: actor.userId, tresorierAt: now }
    : action === "approve2" ? { pasteurId: actor.userId, pasteurAt: now }
    : { rejectedReason: comment };
  await repo.updateRequest(tx, id, { status: next, ...stamp });
  await repo.insertEvent(tx, { requestId: id, fromStatus: req.status, toStatus: next, actorId: actor.userId, comment: comment || null });
  await audit(tx, {
    parishId: req.parishId, actorId: actor.userId, action: `change_request.${action}`, entity: "change_request", entityId: id,
    before: { status: req.status }, after: { status: next, comment },
  });
  if (next === "approuvee_n2") {
    await execute(tx, { ...req, ...stamp } as typeof req, actor.userId);
    const executedAt = new Date();
    await repo.updateRequest(tx, id, { status: "executee", executedAt });
    await repo.insertEvent(tx, { requestId: id, fromStatus: "approuvee_n2", toStatus: "executee", actorId: actor.userId });
    await audit(tx, {
      parishId: req.parishId, actorId: actor.userId, action: "change_request.execute", entity: "change_request", entityId: id,
      before: { status: "approuvee_n2", oldValues: req.oldValues }, after: { status: "executee", kind: req.kind, proposedChanges: req.proposedChanges },
    });
  }
  const full = await repo.findRequestView(tx, id);
  return flat(full!);
}

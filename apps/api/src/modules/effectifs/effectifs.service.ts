import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { can, transition, WorkflowError, type TxAction, type TxStatus } from "@church/shared";
import { audit } from "../../services/audit";
import type { AttendanceActionInput, AttendanceDayInput, AttendanceInput, AttendanceQuery, Counts, MemberInput, WorkerInput } from "./effectifs.dto";
import * as repo from "./effectifs.repo";

/**
 * Who is acting. `parishId` is a lazy getter (requireParish) so the "select a parish" error is raised
 * at the same point as before, i.e. only when the service actually needs the parish.
 */
export type Actor = { userId: string; parishId: string; roles: any };

const upsertDay = async (tx: Tx, parishId: string, actorId: string, serviceDate: string, serviceType: string, n: Counts) => {
  const ex = await repo.findAttendanceForDay(tx, parishId, serviceDate, serviceType);
  if (!ex) {
    const a = await repo.insertAttendance(tx, parishId, actorId, serviceDate, serviceType, n);
    await audit(tx, { parishId, actorId, action: "attendance.create", entity: "attendance", entityId: a.id, after: a });
    return a;
  }
  if (ex.enteredBy !== actorId || (ex.status !== "brouillon" && ex.status !== "rejetee"))
    throw new HTTPException(422, { message: `Un comptage existe déjà pour « ${serviceType} » à cette date (${ex.status}) : modification impossible` });
  const a = await repo.updateAttendanceCounts(tx, ex.id, n);
  await audit(tx, { parishId, actorId, action: "attendance.update", entity: "attendance", entityId: ex.id, before: ex, after: a });
  return a;
};

async function checkDept(tx: Tx, parishId: string, departmentId: string | null) {
  if (!departmentId) return;
  const d = await repo.findDepartment(tx, departmentId, parishId);
  if (!d) throw new HTTPException(422, { message: "Département inconnu pour cette paroisse" });
}

// Effectifs des cultes: one row per (paroisse, date, culte), same validation flow as transactions.
export const listAttendance = (tx: Tx, q: AttendanceQuery) => repo.listAttendance(tx, q);

export function saveAttendance(tx: Tx, actor: Actor, b: AttendanceInput) {
  const { serviceDate, serviceType, ...n } = b;
  return upsertDay(tx, actor.parishId, actor.userId, serviceDate, serviceType, n);
}

/** Fails fast (before any parish check) when the same culte appears twice. */
export function assertDistinctCultes(b: AttendanceDayInput) {
  if (new Set(b.cultes.map((x) => x.serviceType)).size !== b.cultes.length) throw new HTTPException(422, { message: "Culte en double dans la journée" });
}

export async function saveAttendanceDay(tx: Tx, actor: Actor, b: AttendanceDayInput) {
  const out = [];
  for (const x of b.cultes) out.push(await upsertDay(tx, actor.parishId, actor.userId, b.date, x.serviceType, x.counts));
  return out;
}

export async function transitionAttendance(tx: Tx, actor: Actor, id: string, action: TxAction, body: AttendanceActionInput) {
  const comment = (body as any)?.comment as string | undefined;
  const a = await repo.findAttendance(tx, id);
  if (!a) throw new HTTPException(404);
  let next: TxStatus;
  try {
    next = transition({ status: a.status as TxStatus, action, actorId: actor.userId, enteredBy: a.enteredBy, actorRoles: actor.roles, comment });
  } catch (e) {
    if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
  const u = await repo.setAttendanceStatus(tx, a.id, next);
  await audit(tx, { parishId: a.parishId, actorId: actor.userId, action: `attendance.${action}`, entity: "attendance", entityId: a.id, before: { status: a.status }, after: { status: next, comment } });
  return u;
}

// Membres
export function listMembers(tx: Tx, actor: Actor) {
  if (!can(actor.roles, "registry.write") && !can(actor.roles, "transaction.readAll")) throw new HTTPException(403, { message: "Permission refusée" });
  return repo.listMembers(tx);
}

export async function createMember(tx: Tx, actor: Actor, b: MemberInput) {
  const m = await repo.insertMember(tx, actor.parishId, b);
  await audit(tx, { parishId: m.parishId, actorId: actor.userId, action: "member.create", entity: "member", entityId: m.id, after: m });
  return m;
}

export async function updateMember(tx: Tx, actor: Actor, id: string, b: MemberInput) {
  const parishId = actor.parishId;
  const old = await repo.findMember(tx, id, parishId);
  if (!old) throw new HTTPException(404, { message: "Membre introuvable" });
  const m = await repo.updateMember(tx, old.id, b);
  await audit(tx, { parishId, actorId: actor.userId, action: "member.update", entity: "member", entityId: old.id, before: old, after: m });
  return m;
}

export async function deleteMember(tx: Tx, actor: Actor, id: string) {
  try {
    const parishId = actor.parishId;
    const old = await repo.deleteMember(tx, id, parishId);
    if (!old) throw new HTTPException(404, { message: "Membre introuvable" });
    await audit(tx, { parishId, actorId: actor.userId, action: "member.delete", entity: "member", entityId: old.id, before: old });
    return { ok: true };
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    throw new HTTPException(422, { message: "Ce membre est lié à des promesses ou des opérations : suppression impossible" });
  }
}

// Ouvriers
export function listWorkers(tx: Tx, actor: Actor) {
  if (!can(actor.roles, "registry.write") && !can(actor.roles, "transaction.readAll")) throw new HTTPException(403, { message: "Permission refusée" });
  return repo.listWorkers(tx);
}

export async function createWorker(tx: Tx, actor: Actor, b: WorkerInput) {
  const parishId = actor.parishId;
  await checkDept(tx, parishId, b.departmentId);
  const w = await repo.insertWorker(tx, parishId, b);
  await audit(tx, { parishId, actorId: actor.userId, action: "worker.create", entity: "worker", entityId: w.id, after: w });
  return w;
}

export async function updateWorker(tx: Tx, actor: Actor, id: string, b: WorkerInput) {
  const parishId = actor.parishId;
  const old = await repo.findWorker(tx, id, parishId);
  if (!old) throw new HTTPException(404, { message: "Ouvrier introuvable" });
  await checkDept(tx, parishId, b.departmentId);
  const w = await repo.updateWorker(tx, old.id, b);
  await audit(tx, { parishId, actorId: actor.userId, action: "worker.update", entity: "worker", entityId: old.id, before: old, after: w });
  return w;
}

export async function deleteWorker(tx: Tx, actor: Actor, id: string) {
  const parishId = actor.parishId;
  const old = await repo.deleteWorker(tx, id, parishId);
  if (!old) throw new HTTPException(404, { message: "Ouvrier introuvable" });
  await audit(tx, { parishId, actorId: actor.userId, action: "worker.delete", entity: "worker", entityId: old.id, before: old });
  return { ok: true };
}

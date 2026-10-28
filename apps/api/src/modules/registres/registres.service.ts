import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { isEditable, registryTransition, WorkflowError, type RegistryAction, type RegistryState, type Role } from "@church/shared";
import type { z } from "zod";
import type { AppEnv } from "../../env";
import { audit } from "../../services/audit";
import { ALLOWED, MAX_BYTES, schemas, type RecordActionInput, type RecordListQuery } from "./registres.dto";
import * as repo from "./registres.repo";

export type TypeKey = repo.TypeKey;
export type Actor = { userId: string; roles: readonly Role[] };
/** R2 bucket holding the register attachments (passed in by the controller). */
export type Files = AppEnv["Bindings"]["FILES"];

export const isTypeKey = (t: string): t is TypeKey => t in repo.TYPES;

export const parse = <T extends TypeKey>(t: T, body: unknown, partial = false) => {
  const s: z.ZodObject<any> = schemas[t];
  const r = (partial ? s.partial() : s).safeParse(body);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues[0]?.message ?? "Données invalides" });
  return r.data as Record<string, unknown>;
};

export const assertUploadable = (file: File) => {
  if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Fichier trop volumineux (8 Mo max)" });
  if (!ALLOWED.includes(file.type)) throw new HTTPException(415, { message: "Type de fichier non autorisé (JPEG, PNG, WebP ou PDF)" });
};

export const listPastors = (tx: Tx, parishId: string) => repo.listPastors(tx, parishId);

/**
 * Baptêmes and mariages: a draft (or a rejected entry) is changed only by its author, like a transaction; once
 * submitted it is frozen (trigger guard_registry_records). Dédicaces have no circuit and stay open to every registry user.
 */
function assertEditable(t: TypeKey, rec: { status?: string; createdBy: string }, actor: Actor) {
  if (!repo.TYPES[t].workflow) return;
  if (!isEditable(rec.status as any)) throw new HTTPException(422, { message: "Enregistrement soumis ou validé : modification impossible" });
  if (rec.createdBy !== actor.userId) throw new HTTPException(422, { message: "Seul l'auteur peut modifier ce brouillon" });
}

export async function getFile(tx: Tx, fileId: string) {
  const f = await repo.findFile(tx, fileId);
  if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
  return f;
}

/** Returns the R2 key to remove once the transaction has committed. */
export async function deleteFile(tx: Tx, actor: Actor, fileId: string) {
  const f = await repo.findFile(tx, fileId);
  if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
  const t = repo.typeOfRecordType(f.recordType);
  const rec = t && repo.TYPES[t].workflow ? await repo.findRecordRef(tx, t, f.recordId) : undefined;
  if (t && rec) assertEditable(t, rec, actor);
  await repo.deleteFile(tx, f.id);
  await audit(tx, { parishId: f.parishId, actorId: actor.userId, action: "registry.file.delete", entity: "record_file", entityId: f.id, before: f });
  return f.r2Key;
}

export const listFiles = (tx: Tx, t: TypeKey, recordId: string) => repo.listFiles(tx, t, recordId);

export async function addFile(tx: Tx, actor: Actor, files: Files, t: TypeKey, recordId: string, file: File) {
  const rec = await repo.findRecordRef(tx, t, recordId);
  if (!rec) throw new HTTPException(404, { message: "Enregistrement introuvable" });
  const key = `${rec.parishId}/registres/${t}/${rec.id}/${crypto.randomUUID()}`;
  await files.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const f = await repo.insertFile(tx, { parishId: rec.parishId, recordType: repo.TYPES[t].recordType, recordId: rec.id, r2Key: key, filename: file.name || "document", contentType: file.type, uploadedBy: actor.userId });
  await audit(tx, { parishId: rec.parishId, actorId: actor.userId, action: "registry.file.add", entity: "record_file", entityId: f.id, after: { recordType: repo.TYPES[t].recordType, recordId: rec.id, filename: f.filename } });
  return f;
}

export async function listRecords(tx: Tx, t: TypeKey, query: RecordListQuery) {
  const rows = await repo.listRecords(tx, t, query);
  return rows.map(({ r, fileCount, ...names }: any) => ({ ...r, ...names, fileCount, hasFile: fileCount > 0 }));
}

export async function createRecord(tx: Tx, actor: Actor, parishId: string, t: TypeKey, data: Record<string, unknown>) {
  const r = await repo.insertRecord(tx, t, { ...data, parishId, createdBy: actor.userId });
  await audit(tx, { parishId, actorId: actor.userId, action: `${repo.TYPES[t].entity}.create`, entity: repo.TYPES[t].entity, entityId: r.id, after: r });
  return r;
}

export async function updateRecord(tx: Tx, actor: Actor, t: TypeKey, id: string, data: Record<string, unknown>) {
  const before = await repo.findRecord(tx, t, id);
  if (!before) throw new HTTPException(404, { message: "Enregistrement introuvable" });
  assertEditable(t, before, actor);
  const after = Object.keys(data).length ? await repo.updateRecord(tx, t, before.id, data) : before;
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: `${repo.TYPES[t].entity}.update`, entity: repo.TYPES[t].entity, entityId: before.id, before, after });
  return after;
}

/** Returns the R2 keys of the record's files, to remove once the transaction has committed. */
export async function deleteRecord(tx: Tx, actor: Actor, t: TypeKey, id: string) {
  const before = await repo.findRecord(tx, t, id);
  if (!before) throw new HTTPException(404, { message: "Enregistrement introuvable" });
  assertEditable(t, before, actor);
  const files = await repo.listFilesOfRecord(tx, t, before.id);
  if (files.length) await repo.deleteFilesByIds(tx, files.map((f) => f.id));
  await repo.deleteRecord(tx, t, before.id);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: `${repo.TYPES[t].entity}.delete`, entity: repo.TYPES[t].entity, entityId: before.id, before: { ...before, files: files.map((f) => ({ id: f.id, filename: f.filename })) } });
  return files.map((f) => f.r2Key);
}

/**
 * One step of the Pasteur assistant → Pasteur titulaire circuit (baptêmes, mariages). The signatures are stamped on
 * the entry; a (re)submission recomputes the creator-skip and clears the previous round's signatures and motif.
 */
export async function actOnRecord(tx: Tx, actor: Actor, t: TypeKey, id: string, action: RegistryAction, body: RecordActionInput) {
  if (!repo.TYPES[t].workflow) throw new HTTPException(404, { message: "Ce registre n'a pas de circuit de validation" });
  const comment = body?.comment?.trim() || undefined;
  const rec = await repo.findRecord(tx, t, id);
  if (!rec) throw new HTTPException(404, { message: "Enregistrement introuvable" });
  let next: RegistryState;
  try {
    next = registryTransition({
      status: rec.status, action, actorId: actor.userId, enteredBy: rec.createdBy, actorRoles: actor.roles, comment,
      validator1Id: rec.validator1Id, n1Skipped: rec.n1Skipped, n2Skipped: rec.n2Skipped,
    });
  } catch (e) {
    if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
  const now = new Date();
  const patch: Record<string, unknown> = { status: next.status };
  if (action === "submit")
    Object.assign(patch, { n1Skipped: next.n1Skipped, n2Skipped: next.n2Skipped, submittedAt: now, rejectionReason: null,
      validator1Id: null, validator1At: null, validator2Id: null, validator2At: null });
  if (action === "validate1") Object.assign(patch, { validator1Id: actor.userId, validator1At: now });
  if (action === "validate2") Object.assign(patch, { validator2Id: actor.userId, validator2At: now });
  if (action === "reject" || action === "reopen") patch.rejectionReason = comment;
  const after = await repo.transitionRecord(tx, t, rec.id, rec.status, patch);
  if (!after) throw new HTTPException(409, { message: "Cet enregistrement vient d'être traité par quelqu'un d'autre" });
  const entity = repo.TYPES[t].entity;
  await audit(tx, { parishId: rec.parishId, actorId: actor.userId, action: `${entity}.${action}`, entity, entityId: rec.id,
    before: { status: rec.status }, after: { status: next.status, comment, n1Skipped: next.n1Skipped, n2Skipped: next.n2Skipped } });
  return after;
}

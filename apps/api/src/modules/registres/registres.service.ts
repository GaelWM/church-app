import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import type { z } from "zod";
import type { AppEnv } from "../../env";
import { audit } from "../../services/audit";
import { ALLOWED, MAX_BYTES, schemas, type RecordListQuery } from "./registres.dto";
import * as repo from "./registres.repo";

export type TypeKey = repo.TypeKey;
export type Actor = { userId: string };
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

export async function getFile(tx: Tx, fileId: string) {
  const f = await repo.findFile(tx, fileId);
  if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
  return f;
}

/** Returns the R2 key to remove once the transaction has committed. */
export async function deleteFile(tx: Tx, actor: Actor, fileId: string) {
  const f = await repo.findFile(tx, fileId);
  if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
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
  return rows.map((x: any) => ({ ...x.r, fileCount: x.fileCount, hasFile: x.fileCount > 0 }));
}

export async function createRecord(tx: Tx, actor: Actor, parishId: string, t: TypeKey, data: Record<string, unknown>) {
  const r = await repo.insertRecord(tx, t, { ...data, parishId, createdBy: actor.userId });
  await audit(tx, { parishId, actorId: actor.userId, action: `${repo.TYPES[t].entity}.create`, entity: repo.TYPES[t].entity, entityId: r.id, after: r });
  return r;
}

export async function updateRecord(tx: Tx, actor: Actor, t: TypeKey, id: string, data: Record<string, unknown>) {
  const before = await repo.findRecord(tx, t, id);
  if (!before) throw new HTTPException(404, { message: "Enregistrement introuvable" });
  const after = Object.keys(data).length ? await repo.updateRecord(tx, t, before.id, data) : before;
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: `${repo.TYPES[t].entity}.update`, entity: repo.TYPES[t].entity, entityId: before.id, before, after });
  return after;
}

/** Returns the R2 keys of the record's files, to remove once the transaction has committed. */
export async function deleteRecord(tx: Tx, actor: Actor, t: TypeKey, id: string) {
  const before = await repo.findRecord(tx, t, id);
  if (!before) throw new HTTPException(404, { message: "Enregistrement introuvable" });
  const files = await repo.listFilesOfRecord(tx, t, before.id);
  if (files.length) await repo.deleteFilesByIds(tx, files.map((f) => f.id));
  await repo.deleteRecord(tx, t, before.id);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: `${repo.TYPES[t].entity}.delete`, entity: repo.TYPES[t].entity, entityId: before.id, before: { ...before, files: files.map((f) => ({ id: f.id, filename: f.filename })) } });
  return files.map((f) => f.r2Key);
}

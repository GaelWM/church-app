import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { audit } from "../../services/audit";
import type { Files } from "./upload";
import * as repo from "./attachments.repo";

export type Actor = { userId: string; parishId: string };

export const listForTransaction = repo.listByTransaction;

export async function addToTransaction(tx: Tx, actor: { userId: string }, files: Files, txId: string, file: File) {
  const t = await repo.findTransaction(tx, txId);
  if (!t) throw new HTTPException(404, { message: "Écriture introuvable" });
  const key = `${t.parishId}/${t.id}/${crypto.randomUUID()}`;
  await files.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const a = await repo.insert(tx, { transactionId: t.id, parishId: t.parishId, r2Key: key, filename: file.name });
  await audit(tx, { parishId: t.parishId, actorId: actor.userId, action: "attachment.add", entity: "attachment", entityId: a.id });
  return a;
}

/** Returns the R2 key of an attachment (404 when unknown). */
export async function getFileKey(tx: Tx, id: string) {
  const a = await repo.findById(tx, id);
  if (!a) throw new HTTPException(404);
  return a.r2Key;
}

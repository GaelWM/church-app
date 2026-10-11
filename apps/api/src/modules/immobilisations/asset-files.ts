import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { auditLog, fixedAssets, recordFiles, users, type Tx } from "@church/db";
import { audit } from "../../services/audit";
import type { Files } from "../attachments/upload";
import * as repo from "./immobilisations.repo";

/** Photos and scanned invoices of an asset live in record_files, like the registers' files (record_type = "asset"). */
export const ASSET_RECORD_TYPE = "asset";
export type FileActor = { userId: string; parishId: string };

export async function listFiles(tx: Tx, assetId: string) {
  if (!(await repo.findAsset(tx, assetId))) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  return tx.select({
    id: recordFiles.id, filename: recordFiles.filename, contentType: recordFiles.contentType, createdAt: recordFiles.createdAt, uploadedByName: users.fullName,
  }).from(recordFiles).innerJoin(users, eq(users.id, recordFiles.uploadedBy))
    .where(and(eq(recordFiles.recordType, ASSET_RECORD_TYPE), eq(recordFiles.recordId, assetId))).orderBy(desc(recordFiles.createdAt));
}

export async function addFile(tx: Tx, actor: FileActor, files: Files, assetId: string, file: File) {
  const asset = await repo.findAsset(tx, assetId);
  if (!asset || asset.parishId !== actor.parishId) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  if (asset.statut === "annule") throw new HTTPException(422, { message: "Immobilisation annulée: aucune pièce ne peut être ajoutée" });
  const key = `${asset.parishId}/immobilisations/${asset.id}/${crypto.randomUUID()}`;
  await files.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const [f] = await tx.insert(recordFiles).values({
    parishId: asset.parishId, recordType: ASSET_RECORD_TYPE, recordId: asset.id, r2Key: key,
    filename: file.name || "document", contentType: file.type, uploadedBy: actor.userId,
  }).returning();
  await audit(tx, { parishId: asset.parishId, actorId: actor.userId, action: "asset.file.add", entity: "fixed_asset", entityId: asset.id, after: { fileId: f!.id, filename: f!.filename } });
  return f!;
}

export async function getFile(tx: Tx, fileId: string) {
  const [f] = await tx.select().from(recordFiles).where(and(eq(recordFiles.id, fileId), eq(recordFiles.recordType, ASSET_RECORD_TYPE)));
  if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
  return f;
}

/** Returns the R2 key to remove once the transaction has committed. */
export async function deleteFile(tx: Tx, actor: FileActor, fileId: string) {
  const f = await getFile(tx, fileId);
  await tx.delete(recordFiles).where(eq(recordFiles.id, f.id));
  await audit(tx, { parishId: f.parishId, actorId: actor.userId, action: "asset.file.delete", entity: "fixed_asset", entityId: f.recordId, before: { fileId: f.id, filename: f.filename } });
  return f.r2Key;
}

/** Removes every file row of an asset (when its draft is deleted) and returns their storage keys. */
export async function removeAllFiles(tx: Tx, assetId: string): Promise<string[]> {
  const rows = await tx.delete(recordFiles).where(and(eq(recordFiles.recordType, ASSET_RECORD_TYPE), eq(recordFiles.recordId, assetId))).returning({ key: recordFiles.r2Key });
  return rows.map((r) => r.key);
}

// ---- printing / export trail ---------------------------------------------------------------------------------------------

export type PrintKind = "code" | "etiquette" | "export";

/**
 * Records who printed a code or an étiquette, or exported a fiche, one audit row per asset. Printing again what was already
 * printed (same kind) is logged as a reprint. Only validated (active) assets are labelled: the code is printed after the validation.
 */
export async function logPrint(tx: Tx, actor: FileActor, ids: string[], kind: PrintKind) {
  const unique = [...new Set(ids)];
  const rows = await tx.select({ id: fixedAssets.id, code: fixedAssets.code, statut: fixedAssets.statut, parishId: fixedAssets.parishId })
    .from(fixedAssets).where(inArray(fixedAssets.id, unique));
  if (rows.length !== unique.length || rows.some((r) => r.parishId !== actor.parishId)) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  if (kind !== "export") {
    const notActive = rows.filter((r) => r.statut !== "actif");
    if (notActive.length)
      throw new HTTPException(422, { message: `Seule une immobilisation validée peut être imprimée (${notActive.slice(0, 3).map((r) => r.code).join(", ")}${notActive.length > 3 ? "…" : ""})` });
  }
  const before = kind === "export" ? [] : await tx.select({ id: auditLog.entityId }).from(auditLog)
    .where(and(eq(auditLog.action, "asset.print"), sql`${auditLog.after}->>'kind' = ${kind}`, inArray(auditLog.entityId, unique)));
  const printed = new Set(before.map((b) => b.id));
  let reprints = 0;
  for (const r of rows) {
    const reprint = printed.has(r.id);
    if (reprint) reprints += 1;
    await audit(tx, {
      parishId: actor.parishId, actorId: actor.userId, entity: "fixed_asset", entityId: r.id, after: { kind, code: r.code },
      action: kind === "export" ? "asset.export" : reprint ? "asset.reprint" : "asset.print",
    });
  }
  return { logged: rows.length, reprints };
}

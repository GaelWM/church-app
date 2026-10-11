import type { Context } from "hono";
import type { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { AssetDraftInput } from "@church/shared";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { readUploadedFile } from "../attachments/upload";
import * as files from "./asset-files";
import { createRequest as createAssetRequest, type AssetRequestInput } from "../asset-requests/asset-requests.service";
import { run } from "../../services/run";
import { discardSchema, submitSchema, type ListQuery, type printLogSchema } from "./immobilisations.dto";
import * as service from "./immobilisations.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c), roles: c.get("roles") });
const idOf = (c: C) => c.req.param("id" as never) as string;
const asOfOf = (c: C) => {
  const v = c.req.query("asOf");
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
};

export const list = async (c: C, q: ListQuery) => c.json(await run(c, (tx) => service.listAssets(tx, q)));

export const get = async (c: C) => {
  const id = idOf(c);
  const asOf = asOfOf(c);
  return c.json(await run(c, (tx) => service.getAsset(tx, id, asOf)));
};

export const create = async (c: C, body: AssetDraftInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createDraft(tx, actor, body)), 201);
};

export const update = async (c: C, body: AssetDraftInput) => {
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.updateDraft(tx, actor, id, body)));
};

export const remove = async (c: C) => {
  const actor = actorOf(c);
  const id = idOf(c);
  const keys = await run(c, (tx) => service.deleteDraft(tx, actor, id));
  await Promise.all(keys.map((k) => c.env.FILES.delete(k))); // only after the database change committed
  return c.body(null, 204);
};

export const discard = async (c: C) => {
  const parsed = discardSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join(" ; ") });
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.discard(tx, actor, id, parsed.data.reason)));
};

/** The comment is optional, so an empty body is fine. */
export const submit = async (c: C) => {
  const parsed = submitSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: "Requête invalide" });
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.submit(tx, actor, id, parsed.data.comment)), 201);
};

export const changeEtat = async (c: C, body: service.EtatChangeInput) => {
  const actor = actorOf(c);
  const id = idOf(c);
  const r = await run(c, (tx) => service.changeEtat(tx, actor, id, body));
  return c.json(r, r.pending ? 202 : 200);
};

export const etatHistory = async (c: C) => {
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.etatHistory(tx, id)));
};

export const auditTrail = async (c: C) => {
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.auditTrail(tx, id)));
};

export const createRequest = async (c: C, body: AssetRequestInput) => {
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => createAssetRequest(tx, actor, id, body)), 201);
};

// ---- pièces jointes (photos, factures) ----------------------------------------------------------------------------------

export const listFiles = async (c: C) => {
  const id = idOf(c);
  return c.json(await run(c, (tx) => files.listFiles(tx, id)));
};

export const addFile = async (c: C) => {
  const actor = actorOf(c);
  const id = idOf(c);
  const file = await readUploadedFile(c);
  return c.json(await run(c, (tx) => files.addFile(tx, actor, c.env.FILES, id, file)), 201);
};

export const getFile = async (c: C) => {
  const fileId = c.req.param("fileId" as never) as string;
  const f = await run(c, (tx) => files.getFile(tx, fileId));
  const obj = await c.env.FILES.get(f.r2Key);
  if (!obj) throw new HTTPException(404, { message: "Fichier introuvable" });
  const type = f.contentType ?? obj.httpMetadata?.contentType ?? "application/octet-stream";
  const disposition = c.req.query("download") ? "attachment" : "inline";
  return new Response(obj.body, {
    headers: {
      "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    },
  });
};

export const deleteFile = async (c: C) => {
  const actor = actorOf(c);
  const fileId = c.req.param("fileId" as never) as string;
  const key = await run(c, (tx) => files.deleteFile(tx, actor, fileId));
  await c.env.FILES.delete(key); // only after the database change committed
  return c.body(null, 204);
};

export const logPrint = async (c: C, body: z.infer<typeof printLogSchema>) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => files.logPrint(tx, actor, body.ids, body.kind)));
};

export const reportData = async (c: C, q: ListQuery) => c.json(await run(c, (tx) => service.reportData(tx, q)));

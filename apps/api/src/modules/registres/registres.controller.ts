import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { can } from "@church/shared";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import * as service from "./registres.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id });

const typeOf = (c: C): service.TypeKey => {
  const t = c.req.param("type" as never) as string;
  if (!service.isTypeKey(t)) throw new HTTPException(404, { message: "Registre inconnu" });
  return t;
};
const canRead = (roles: any) => can(roles, "registry.write") || can(roles, "transaction.readAll");
export const readGuard = async (c: C, next: Next) => {
  if (!canRead(c.get("roles"))) throw new HTTPException(403, { message: "Permission refusée" });
  await next();
};

async function removeFiles(c: C, keys: string[]) {
  await Promise.all(keys.map((k) => c.env.FILES.delete(k)));
}

// Active users holding the Pasteur role in the current parish: feeds the "Pasteur" dropdowns.
export const listPastors = async (c: C) => {
  const parishId = c.get("parishId");
  if (!parishId) return c.json([]); // consolidated view is read-only: nothing to pick
  return c.json(await run(c, (tx) => service.listPastors(tx, parishId)));
};

export const getFile = async (c: C) => {
  const fileId = c.req.param("fileId" as never) as string;
  const f = await run(c, (tx) => service.getFile(tx, fileId));
  const obj = await c.env.FILES.get(f.r2Key);
  if (!obj) throw new HTTPException(404, { message: "Fichier introuvable" });
  const type = f.contentType ?? obj.httpMetadata?.contentType ?? "application/octet-stream";
  const headers: Record<string, string> = { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" };
  const name = encodeURIComponent(f.filename);
  headers["content-disposition"] = `${c.req.query("download") ? "attachment" : "inline"}; filename*=UTF-8''${name}`;
  return new Response(obj.body, { headers });
};

export const deleteFile = async (c: C) => {
  const actor = actorOf(c);
  const fileId = c.req.param("fileId" as never) as string;
  const key = await run(c, (tx) => service.deleteFile(tx, actor, fileId));
  await removeFiles(c, [key]);
  return c.body(null, 204);
};

export const listFiles = async (c: C) => {
  const t = typeOf(c);
  const id = c.req.param("id" as never) as string;
  return c.json(await run(c, (tx) => service.listFiles(tx, t, id)));
};

export const addFile = async (c: C) => {
  const t = typeOf(c);
  const actor = actorOf(c);
  const id = c.req.param("id" as never) as string;
  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | string | null;
  if (!file || typeof file === "string") throw new HTTPException(400, { message: "Fichier manquant" });
  service.assertUploadable(file);
  const row = await run(c, (tx) => service.addFile(tx, actor, c.env.FILES, t, id, file));
  return c.json(row, 201);
};

export const listRecords = async (c: C) => {
  const t = typeOf(c);
  const query = c.req.query();
  return c.json(await run(c, (tx) => service.listRecords(tx, t, query)));
};

export const createRecord = async (c: C) => {
  const t = typeOf(c);
  const parishId = requireParish(c);
  const actor = actorOf(c);
  const data = service.parse(t, await c.req.json().catch(() => ({})));
  const row = await run(c, (tx) => service.createRecord(tx, actor, parishId, t, data));
  return c.json({ ...row, fileCount: 0, hasFile: false }, 201);
};

export const updateRecord = async (c: C) => {
  const t = typeOf(c);
  const actor = actorOf(c);
  const data = service.parse(t, await c.req.json().catch(() => ({})), true);
  const id = c.req.param("id" as never) as string;
  return c.json(await run(c, (tx) => service.updateRecord(tx, actor, t, id, data)));
};

export const deleteRecord = async (c: C) => {
  const t = typeOf(c);
  const actor = actorOf(c);
  const id = c.req.param("id" as never) as string;
  const keys = await run(c, (tx) => service.deleteRecord(tx, actor, t, id));
  await removeFiles(c, keys);
  return c.body(null, 204);
};

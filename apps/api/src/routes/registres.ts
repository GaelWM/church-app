import { Hono } from "hono";
import { getTableName, and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { baptisms, childDedications, marriages, recordFiles, userParishRoles, users } from "@church/db";
import { can } from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** A register entry date: a real calendar day, from 1900 to tomorrow (UTC slack for local time). */
const regDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide").refine((s) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s && t >= Date.UTC(1900, 0, 1) && t <= Date.now() + 86_400_000;
}, "Date hors de la période autorisée");
const opt = z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null));
const req = (label: string) => z.string({ message: `${label} requis` }).trim().min(1, `${label} requis`).max(300);

const schemas = {
  dedications: z.object({ date: regDate, childName: req("Nom de l'enfant"), motherName: opt, fatherName: opt, pastorName: opt, formCompleted: z.boolean().optional() }),
  baptisms: z.object({ fullName: req("Nom"), date: regDate, place: opt, address: opt, phone: opt, email: z.string().trim().email("Email invalide").optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)), whatsapp: opt, pastorName: opt }),
  marriages: z.object({ husbandName: req("Nom de l'époux"), wifeName: req("Nom de l'épouse"), coupleAddress: opt, phone: opt, date: regDate, pastorName: opt, blessingPlace: opt }),
} as const;

const TYPES = {
  dedications: { table: childDedications, recordType: "dedication", entity: "child_dedication", search: [childDedications.childName, childDedications.motherName, childDedications.fatherName] },
  baptisms: { table: baptisms, recordType: "baptism", entity: "baptism", search: [baptisms.fullName, baptisms.phone, baptisms.email, baptisms.place] },
  marriages: { table: marriages, recordType: "marriage", entity: "marriage", search: [marriages.husbandName, marriages.wifeName, marriages.phone] },
} as const;
type TypeKey = keyof typeof TYPES;

const typeOf = (c: { req: { param: (k: string) => string } }): TypeKey => {
  const t = c.req.param("type");
  if (!(t in TYPES)) throw new HTTPException(404, { message: "Registre inconnu" });
  return t as TypeKey;
};
const parse = <T extends TypeKey>(t: T, body: unknown, partial = false) => {
  const s: z.ZodObject<any> = schemas[t];
  const r = (partial ? s.partial() : s).safeParse(body);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues[0]?.message ?? "Données invalides" });
  return r.data as Record<string, unknown>;
};
const canRead = (roles: any) => can(roles, "registry.write") || can(roles, "transaction.readAll");
const readGuard = async (c: any, next: any) => {
  if (!canRead(c.get("roles"))) throw new HTTPException(403, { message: "Permission refusée" });
  await next();
};

async function removeFiles(c: { env: AppEnv["Bindings"] }, keys: string[]) {
  await Promise.all(keys.map((k) => c.env.FILES.delete(k)));
}

export const registreRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .use(readGuard)
  // Active users holding the Pasteur role in the current parish: feeds the "Pasteur" dropdowns.
  .get("/pastors", async (c) => {
    const parishId = c.get("parishId");
    if (!parishId) return c.json([]); // consolidated view is read-only: nothing to pick
    const rows = await run(c, (tx) => tx.select({ id: users.id, fullName: users.fullName }).from(userParishRoles)
      .innerJoin(users, eq(users.id, userParishRoles.userId))
      .where(and(eq(userParishRoles.parishId, parishId), eq(userParishRoles.role, "pasteur"), eq(users.active, true)))
      .orderBy(users.fullName));
    return c.json(rows);
  })
  // ---- files (defined before /:type routes so "files" is never read as a register)
  .get("/files/:fileId", async (c) => {
    const f = await run(c, async (tx) => (await tx.select().from(recordFiles).where(eq(recordFiles.id, c.req.param("fileId"))))[0]);
    if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
    const obj = await c.env.FILES.get(f.r2Key);
    if (!obj) throw new HTTPException(404, { message: "Fichier introuvable" });
    const type = f.contentType ?? obj.httpMetadata?.contentType ?? "application/octet-stream";
    const headers: Record<string, string> = { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" };
    const name = encodeURIComponent(f.filename);
    headers["content-disposition"] = `${c.req.query("download") ? "attachment" : "inline"}; filename*=UTF-8''${name}`;
    return new Response(obj.body, { headers });
  })
  .delete("/files/:fileId", requirePerm("registry.write"), async (c) => {
    const key = await run(c, async (tx) => {
      const [f] = await tx.select().from(recordFiles).where(eq(recordFiles.id, c.req.param("fileId")));
      if (!f) throw new HTTPException(404, { message: "Fichier introuvable" });
      await tx.delete(recordFiles).where(eq(recordFiles.id, f.id));
      await audit(tx, { parishId: f.parishId, actorId: c.get("user").id, action: "registry.file.delete", entity: "record_file", entityId: f.id, before: f });
      return f.r2Key;
    });
    await removeFiles(c, [key]);
    return c.body(null, 204);
  })
  .get("/:type/:id/files", async (c) => {
    const t = typeOf(c);
    return c.json(await run(c, (tx) => tx.select().from(recordFiles).where(and(eq(recordFiles.recordType, TYPES[t].recordType), eq(recordFiles.recordId, c.req.param("id")))).orderBy(desc(recordFiles.createdAt))));
  })
  .post("/:type/:id/files", requirePerm("registry.write"), async (c) => {
    const t = typeOf(c);
    const form = await c.req.formData();
    const file = form.get("file") as unknown as File | string | null;
    if (!file || typeof file === "string") throw new HTTPException(400, { message: "Fichier manquant" });
    if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Fichier trop volumineux (8 Mo max)" });
    if (!ALLOWED.includes(file.type)) throw new HTTPException(415, { message: "Type de fichier non autorisé (JPEG, PNG, WebP ou PDF)" });
    const row = await run(c, async (tx) => {
      const table: any = TYPES[t].table;
      const [rec] = await tx.select({ id: table.id, parishId: table.parishId }).from(table).where(eq(table.id, c.req.param("id")));
      if (!rec) throw new HTTPException(404, { message: "Enregistrement introuvable" });
      const key = `${rec.parishId}/registres/${t}/${rec.id}/${crypto.randomUUID()}`;
      await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      const [f] = await tx.insert(recordFiles).values({ parishId: rec.parishId, recordType: TYPES[t].recordType, recordId: rec.id, r2Key: key, filename: file.name || "document", contentType: file.type, uploadedBy: c.get("user").id }).returning();
      await audit(tx, { parishId: rec.parishId, actorId: c.get("user").id, action: "registry.file.add", entity: "record_file", entityId: f!.id, after: { recordType: TYPES[t].recordType, recordId: rec.id, filename: f!.filename } });
      return f!;
    });
    return c.json(row, 201);
  })
  // ---- records
  .get("/:type", async (c) => {
    const t = typeOf(c);
    const table: any = TYPES[t].table;
    const { from, to, q, pastor } = c.req.query();
    const conds = [
      from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? gte(table.date, from) : undefined,
      to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? lte(table.date, to) : undefined,
      pastor ? ilike(table.pastorName, `%${pastor.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
      q ? or(...TYPES[t].search.map((col: any) => ilike(col, `%${q.replace(/[%_\\]/g, "\\$&")}%`))) : undefined,
    ].filter(Boolean);
    const rows = await run(c, (tx) =>
      tx.select({ r: table, fileCount: sql<number>`(select count(*)::int from record_files rf where rf.record_type = ${TYPES[t].recordType} and rf.record_id = ${sql.raw(`"${getTableName(table)}"."id"`)})` })
        .from(table).where(and(...conds)).orderBy(desc(table.date), desc(table.createdAt)).limit(1000));
    return c.json(rows.map((x: any) => ({ ...x.r, fileCount: x.fileCount, hasFile: x.fileCount > 0 })));
  })
  .post("/:type", requirePerm("registry.write"), async (c) => {
    const t = typeOf(c);
    const parishId = requireParish(c);
    const data = parse(t, await c.req.json().catch(() => ({})));
    const row = await run(c, async (tx) => {
      const [r] = await tx.insert(TYPES[t].table as any).values({ ...data, parishId, createdBy: c.get("user").id }).returning();
      await audit(tx, { parishId, actorId: c.get("user").id, action: `${TYPES[t].entity}.create`, entity: TYPES[t].entity, entityId: (r as any).id, after: r });
      return r as any;
    });
    return c.json({ ...row, fileCount: 0, hasFile: false }, 201);
  })
  .patch("/:type/:id", requirePerm("registry.write"), async (c) => {
    const t = typeOf(c);
    const data = parse(t, await c.req.json().catch(() => ({})), true);
    const table: any = TYPES[t].table;
    const row = await run(c, async (tx) => {
      const [before] = await tx.select().from(table).where(eq(table.id, c.req.param("id")));
      if (!before) throw new HTTPException(404, { message: "Enregistrement introuvable" });
      const [after] = Object.keys(data).length ? await tx.update(table).set(data).where(eq(table.id, before.id)).returning() : [before];
      await audit(tx, { parishId: before.parishId, actorId: c.get("user").id, action: `${TYPES[t].entity}.update`, entity: TYPES[t].entity, entityId: before.id, before, after });
      return after;
    });
    return c.json(row);
  })
  .delete("/:type/:id", requirePerm("registry.write"), async (c) => {
    const t = typeOf(c);
    const table: any = TYPES[t].table;
    const keys = await run(c, async (tx) => {
      const [before] = await tx.select().from(table).where(eq(table.id, c.req.param("id")));
      if (!before) throw new HTTPException(404, { message: "Enregistrement introuvable" });
      const files = await tx.select().from(recordFiles).where(and(eq(recordFiles.recordType, TYPES[t].recordType), eq(recordFiles.recordId, before.id)));
      if (files.length) await tx.delete(recordFiles).where(inArray(recordFiles.id, files.map((f) => f.id)));
      await tx.delete(table).where(eq(table.id, before.id));
      await audit(tx, { parishId: before.parishId, actorId: c.get("user").id, action: `${TYPES[t].entity}.delete`, entity: TYPES[t].entity, entityId: before.id, before: { ...before, files: files.map((f) => ({ id: f.id, filename: f.filename })) } });
      return files.map((f) => f.r2Key);
    });
    await removeFiles(c, keys);
    return c.body(null, 204);
  });

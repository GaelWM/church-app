import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { attachments, transactions } from "@church/db";
import type { AppEnv } from "../env";
import { parishScope, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export const attachmentRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/transaction/:txId", async (c) => c.json(await run(c, (tx) => tx.select().from(attachments).where(eq(attachments.transactionId, c.req.param("txId"))))))
  .post("/transaction/:txId", requirePerm("transaction.create"), async (c) => {
    const form = await c.req.formData();
    const file = form.get("file") as unknown as File | string | null;
    if (!file || typeof file === "string") throw new HTTPException(400, { message: "Fichier manquant" });
    if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Fichier trop volumineux (8 Mo max)" });
    if (!ALLOWED.includes(file.type)) throw new HTTPException(415, { message: "Type de fichier non autorisé" });
    const row = await run(c, async (tx) => {
      const [t] = await tx.select().from(transactions).where(eq(transactions.id, c.req.param("txId")));
      if (!t) throw new HTTPException(404, { message: "Écriture introuvable" });
      const key = `${t.parishId}/${t.id}/${crypto.randomUUID()}`;
      await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      const [a] = await tx.insert(attachments).values({ transactionId: t.id, parishId: t.parishId, r2Key: key, filename: file.name }).returning();
      await audit(tx, { parishId: t.parishId, actorId: c.get("user").id, action: "attachment.add", entity: "attachment", entityId: a!.id });
      return a!;
    });
    return c.json(row, 201);
  })
  .get("/:id/file", async (c) => {
    const a = await run(c, async (tx) => (await tx.select().from(attachments).where(eq(attachments.id, c.req.param("id"))))[0]);
    if (!a) throw new HTTPException(404);
    const obj = await c.env.FILES.get(a.r2Key);
    if (!obj) throw new HTTPException(404);
    return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
  });

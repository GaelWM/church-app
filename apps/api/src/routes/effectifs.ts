import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { attendanceRecords, departments, members, workers, type Tx } from "@church/db";
import { can, CULTE_TYPES, pastDate, transition, WORKER_CATEGORIES, WorkflowError, type TxAction, type TxStatus } from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";

const count = z.number().int().min(0).max(1_000_000);
const counts = z.object({ mAdulte: count, mEnfant: count, mBebe: count, fAdulte: count, fEnfant: count, fBebe: count });
const culte = z.enum(CULTE_TYPES);
const uuid = z.string().uuid();
const opt = z.string().trim().max(300).optional().nullable().transform((v) => v || null);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const upsertDay = async (tx: Tx, parishId: string, actorId: string, serviceDate: string, serviceType: string, n: z.infer<typeof counts>) => {
  const [ex] = await tx.select().from(attendanceRecords).where(and(eq(attendanceRecords.parishId, parishId), eq(attendanceRecords.serviceDate, serviceDate), eq(attendanceRecords.serviceType, serviceType)));
  if (!ex) {
    const [a] = await tx.insert(attendanceRecords).values({ parishId, serviceDate, serviceType, enteredBy: actorId, ...n }).returning();
    await audit(tx, { parishId, actorId, action: "attendance.create", entity: "attendance", entityId: a!.id, after: a });
    return a!;
  }
  if (ex.enteredBy !== actorId || (ex.status !== "brouillon" && ex.status !== "rejetee"))
    throw new HTTPException(422, { message: `Un comptage existe déjà pour « ${serviceType} » à cette date (${ex.status}) : modification impossible` });
  const [a] = await tx.update(attendanceRecords).set(n).where(eq(attendanceRecords.id, ex.id)).returning();
  await audit(tx, { parishId, actorId, action: "attendance.update", entity: "attendance", entityId: ex.id, before: ex, after: a });
  return a!;
};

const memberBody = z.object({ fullName: z.string().trim().min(1, "Nom requis").max(200), address: opt, whatsapp: opt, phone: opt, email: opt, homeChurch: opt, invitedBy: opt });
const workerBody = z.object({
  category: z.enum(WORKER_CATEGORIES), fullName: z.string().trim().min(1, "Nom requis").max(200), address: opt,
  departmentId: uuid.optional().nullable().transform((v) => v || null), phone: opt, email: opt, whatsapp: opt,
  basicTeachingDone: z.boolean().default(false), active: z.boolean().default(true),
});

export const effectifRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Effectifs des cultes: one row per (paroisse, date, culte), same validation flow as transactions.
  .get("/attendance", zValidator("query", z.object({ from: isoDay.optional(), to: isoDay.optional(), serviceType: z.string().optional() })), async (c) => {
    const q = c.req.valid("query");
    const where = and(q.from ? gte(attendanceRecords.serviceDate, q.from) : undefined, q.to ? lte(attendanceRecords.serviceDate, q.to) : undefined, q.serviceType ? eq(attendanceRecords.serviceType, q.serviceType) : undefined);
    return c.json(await run(c, (tx) => tx.select().from(attendanceRecords).where(where).orderBy(desc(attendanceRecords.serviceDate), attendanceRecords.serviceType)));
  })
  .post("/attendance", requirePerm("transaction.create"), zValidator("json", counts.extend({ serviceDate: pastDate, serviceType: culte })), async (c) => {
    const { serviceDate, serviceType, ...n } = c.req.valid("json");
    return c.json(await run(c, (tx) => upsertDay(tx, requireParish(c), c.get("user").id, serviceDate, serviceType, n)), 201);
  })
  .post("/attendance/day", requirePerm("transaction.create"), zValidator("json", z.object({
    date: pastDate, cultes: z.array(z.object({ serviceType: culte, counts })).min(1),
  })), async (c) => {
    const b = c.req.valid("json");
    if (new Set(b.cultes.map((x) => x.serviceType)).size !== b.cultes.length) throw new HTTPException(422, { message: "Culte en double dans la journée" });
    return c.json(await run(c, async (tx) => {
      const out = [];
      for (const x of b.cultes) out.push(await upsertDay(tx, requireParish(c), c.get("user").id, b.date, x.serviceType, x.counts));
      return out;
    }), 201);
  })
  .post("/attendance/:id/:action{submit|validate1|validate2|reject}", zValidator("json", z.object({ comment: z.string().optional() }).optional()), async (c) => {
    const action = c.req.param("action") as TxAction;
    const comment = (c.req.valid("json") as any)?.comment as string | undefined;
    return c.json(await run(c, async (tx) => {
      const [a] = await tx.select().from(attendanceRecords).where(eq(attendanceRecords.id, c.req.param("id")));
      if (!a) throw new HTTPException(404);
      let next: TxStatus;
      try {
        next = transition({ status: a.status as TxStatus, action, actorId: c.get("user").id, enteredBy: a.enteredBy, actorRoles: c.get("roles"), comment });
      } catch (e) {
        if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
        throw e;
      }
      const [u] = await tx.update(attendanceRecords).set({ status: next }).where(eq(attendanceRecords.id, a.id)).returning();
      await audit(tx, { parishId: a.parishId, actorId: c.get("user").id, action: `attendance.${action}`, entity: "attendance", entityId: a.id, before: { status: a.status }, after: { status: next, comment } });
      return u!;
    }));
  })

  // Membres
  .get("/members", async (c) => {
    const roles = c.get("roles");
    if (!can(roles, "registry.write") && !can(roles, "transaction.readAll")) throw new HTTPException(403, { message: "Permission refusée" });
    return c.json(await run(c, (tx) => tx.select().from(members).orderBy(members.fullName)));
  })
  .post("/members", requirePerm("registry.write"), zValidator("json", memberBody), async (c) =>
    c.json(await run(c, async (tx) => {
      const [m] = await tx.insert(members).values({ parishId: requireParish(c), ...c.req.valid("json") }).returning();
      await audit(tx, { parishId: m!.parishId, actorId: c.get("user").id, action: "member.create", entity: "member", entityId: m!.id, after: m });
      return m!;
    }), 201))
  .put("/members/:id", requirePerm("registry.write"), zValidator("json", memberBody), async (c) =>
    c.json(await run(c, async (tx) => {
      const parishId = requireParish(c);
      const [old] = await tx.select().from(members).where(and(eq(members.id, c.req.param("id")), eq(members.parishId, parishId)));
      if (!old) throw new HTTPException(404, { message: "Membre introuvable" });
      const [m] = await tx.update(members).set(c.req.valid("json")).where(eq(members.id, old.id)).returning();
      await audit(tx, { parishId, actorId: c.get("user").id, action: "member.update", entity: "member", entityId: old.id, before: old, after: m });
      return m!;
    })))
  .delete("/members/:id", requirePerm("registry.write"), async (c) => {
    try {
      return c.json(await run(c, async (tx) => {
        const parishId = requireParish(c);
        const [old] = await tx.delete(members).where(and(eq(members.id, c.req.param("id")), eq(members.parishId, parishId))).returning();
        if (!old) throw new HTTPException(404, { message: "Membre introuvable" });
        await audit(tx, { parishId, actorId: c.get("user").id, action: "member.delete", entity: "member", entityId: old.id, before: old });
        return { ok: true };
      }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      throw new HTTPException(422, { message: "Ce membre est lié à des promesses ou des opérations : suppression impossible" });
    }
  })

  // Ouvriers
  .get("/workers", async (c) => {
    const roles = c.get("roles");
    if (!can(roles, "registry.write") && !can(roles, "transaction.readAll")) throw new HTTPException(403, { message: "Permission refusée" });
    return c.json(await run(c, (tx) => tx.select().from(workers).orderBy(workers.fullName)));
  })
  .post("/workers", requirePerm("registry.write"), zValidator("json", workerBody), async (c) =>
    c.json(await run(c, async (tx) => {
      const parishId = requireParish(c), b = c.req.valid("json");
      await checkDept(tx, parishId, b.departmentId);
      const [w] = await tx.insert(workers).values({ parishId, ...b }).returning();
      await audit(tx, { parishId, actorId: c.get("user").id, action: "worker.create", entity: "worker", entityId: w!.id, after: w });
      return w!;
    }), 201))
  .put("/workers/:id", requirePerm("registry.write"), zValidator("json", workerBody), async (c) =>
    c.json(await run(c, async (tx) => {
      const parishId = requireParish(c), b = c.req.valid("json");
      const [old] = await tx.select().from(workers).where(and(eq(workers.id, c.req.param("id")), eq(workers.parishId, parishId)));
      if (!old) throw new HTTPException(404, { message: "Ouvrier introuvable" });
      await checkDept(tx, parishId, b.departmentId);
      const [w] = await tx.update(workers).set(b).where(eq(workers.id, old.id)).returning();
      await audit(tx, { parishId, actorId: c.get("user").id, action: "worker.update", entity: "worker", entityId: old.id, before: old, after: w });
      return w!;
    })))
  .delete("/workers/:id", requirePerm("registry.write"), async (c) =>
    c.json(await run(c, async (tx) => {
      const parishId = requireParish(c);
      const [old] = await tx.delete(workers).where(and(eq(workers.id, c.req.param("id")), eq(workers.parishId, parishId))).returning();
      if (!old) throw new HTTPException(404, { message: "Ouvrier introuvable" });
      await audit(tx, { parishId, actorId: c.get("user").id, action: "worker.delete", entity: "worker", entityId: old.id, before: old });
      return { ok: true };
    })));

async function checkDept(tx: Tx, parishId: string, departmentId: string | null) {
  if (!departmentId) return;
  const [d] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, departmentId), eq(departments.parishId, parishId)));
  if (!d) throw new HTTPException(422, { message: "Département inconnu pour cette paroisse" });
}

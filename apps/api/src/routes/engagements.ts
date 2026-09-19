import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { attendanceRecords, commitments, members, pledges } from "@church/db";
import { CURRENCIES, transition, WorkflowError, type TxAction, type TxStatus } from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";

const uuid = z.string().uuid();
const amount = z.coerce.bigint().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const engagementRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Members (optional donor list for dîme and pledges)
  .get("/members", async (c) => c.json(await run(c, (tx) => tx.select().from(members))))
  .post("/members", requirePerm("transaction.create"), zValidator("json", z.object({ fullName: z.string().min(1), phone: z.string().optional() })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [m] = await tx.insert(members).values({ parishId: requireParish(c), ...c.req.valid("json") }).returning();
      await audit(tx, { parishId: m!.parishId, actorId: c.get("user").id, action: "member.create", entity: "member", entityId: m!.id, after: m });
      return m!;
    }), 201))

  // Promesses de dons
  .get("/pledges", async (c) => c.json(await run(c, (tx) => tx.select().from(pledges))))
  .post("/pledges", requirePerm("transaction.create"), zValidator("json", z.object({
    memberId: uuid.optional(), donorName: z.string().optional(), categoryId: uuid, currency: z.enum(CURRENCIES), amountMinor: amount, dueDate: date.optional(),
  })), async (c) =>
    c.json(await run(c, async (tx) => {
      const b = c.req.valid("json");
      if (!b.memberId && !b.donorName) throw new HTTPException(422, { message: "Donateur requis" });
      const [p] = await tx.insert(pledges).values({ parishId: requireParish(c), ...b }).returning();
      await audit(tx, { parishId: p!.parishId, actorId: c.get("user").id, action: "pledge.create", entity: "pledge", entityId: p!.id, after: p });
      return p!;
    }), 201))

  // Engagements de dépenses
  .get("/commitments", async (c) => c.json(await run(c, (tx) => tx.select().from(commitments))))
  .post("/commitments", requirePerm("transaction.create"), zValidator("json", z.object({
    categoryId: uuid, payee: z.string().min(1), currency: z.enum(CURRENCIES), amountMinor: amount, dueDate: date.optional(),
  })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [m] = await tx.insert(commitments).values({ parishId: requireParish(c), ...c.req.valid("json") }).returning();
      await audit(tx, { parishId: m!.parishId, actorId: c.get("user").id, action: "commitment.create", entity: "commitment", entityId: m!.id, after: m });
      return m!;
    }), 201))
  // Link a commitment to the dépense that paid it.
  .post("/commitments/:id/paid", requirePerm("transaction.create"), zValidator("json", z.object({ transactionId: uuid })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [m] = await tx.update(commitments).set({ status: "paid", transactionId: c.req.valid("json").transactionId }).where(eq(commitments.id, c.req.param("id"))).returning();
      await audit(tx, { parishId: m?.parishId, actorId: c.get("user").id, action: "commitment.paid", entity: "commitment", entityId: c.req.param("id"), after: m });
      return m;
    })))

  // Effectifs: attendance per service, same validation flow as transactions.
  .get("/attendance", async (c) => c.json(await run(c, (tx) => tx.select().from(attendanceRecords))))
  .post("/attendance", requirePerm("transaction.create"), zValidator("json", z.object({
    serviceDate: date, serviceType: z.string().min(1),
    hommes: z.number().int().min(0), femmes: z.number().int().min(0), jeunes: z.number().int().min(0), enfants: z.number().int().min(0), visiteurs: z.number().int().min(0),
  })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [a] = await tx.insert(attendanceRecords).values({ parishId: requireParish(c), enteredBy: c.get("user").id, ...c.req.valid("json") }).returning();
      await audit(tx, { parishId: a!.parishId, actorId: c.get("user").id, action: "attendance.create", entity: "attendance", entityId: a!.id, after: a });
      return a!;
    }), 201))
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
  });

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { accounts, auditLog, categories, departments, exchangeRates, funds, parishes, userParishRoles, users } from "@church/db";
import { accountSchema, exchangeRateSchema, findRoleConflict, parishSchema, ROLE_PERMISSIONS, ROLES, userCreateSchema, type Role } from "@church/shared";
import { invitation, rateChanged, securityAlert } from "@church/emails";
import type { AppEnv } from "../env";
import { parishScope, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { createAuth0User, passwordSetLink, setAuth0Blocked } from "../services/auth0";
import { safeSend } from "../services/mailer";
import { run } from "../services/run";

/** Parishes where the caller is Administrateur. */
const adminParishes = (c: any): string[] =>
  (c.get("memberships") as Array<{ parishId: string; role: Role }>).filter((m) => m.role === "administrateur").map((m) => m.parishId);

function requireAdmin(c: any) {
  if (!adminParishes(c).length) throw new HTTPException(403, { message: "Permission refusée" });
}

async function alertAdmins(c: any, message: string) {
  const admins = await c.get("db").selectDistinct({ email: users.email }).from(users)
    .innerJoin(userParishRoles, eq(userParishRoles.userId, users.id))
    .where(and(eq(userParishRoles.role, "administrateur"), eq(users.active, true)));
  await safeSend(c.get("mailer"), admins.map((a: any) => ({ to: a.email, ...securityAlert({ message }) })));
}

export const configRoutes = new Hono<AppEnv>()

  .get("/me", async (c) => {
    const ms = c.get("memberships");
    const ps = await c.get("db").select().from(parishes).where(inArray(parishes.id, ms.map((m) => m.parishId).concat("00000000-0000-0000-0000-000000000000")));
    return c.json({
      user: c.get("user"),
      parishes: ps.map((p) => ({ ...p, roles: ms.filter((m) => m.parishId === p.id).map((m) => m.role), consolidatedAccess: ms.some((m) => m.parishId === p.id && m.consolidatedAccess) })),
      permissions: Object.fromEntries(ROLES.map((r) => [r, ROLE_PERMISSIONS[r]])),
    });
  })

  // ── Parishes ─────────────────────────────────────────────
  .post("/parishes", zValidator("json", parishSchema), async (c) => {
    requireAdmin(c);
    const b = c.req.valid("json");
    const [p] = await c.get("db").insert(parishes).values(b).returning();
    // Creator administers what they create.
    await c.get("db").insert(userParishRoles).values({ userId: c.get("user").id, parishId: p!.id, role: "administrateur" });
    await c.get("db").transaction((tx) => audit(tx, { parishId: p!.id, actorId: c.get("user").id, action: "parish.create", entity: "parish", entityId: p!.id, after: p }));
    return c.json(p, 201);
  })
  .patch("/parishes/:id", zValidator("json", parishSchema.partial().extend({ active: z.boolean().optional() })), async (c) => {
    if (!adminParishes(c).includes(c.req.param("id"))) throw new HTTPException(403, { message: "Permission refusée" });
    const [p] = await c.get("db").update(parishes).set(c.req.valid("json")).where(eq(parishes.id, c.req.param("id"))).returning();
    await c.get("db").transaction((tx) => audit(tx, { parishId: p!.id, actorId: c.get("user").id, action: "parish.update", entity: "parish", entityId: p!.id, after: p }));
    return c.json(p);
  })

  // ── Categories & funds (shared by all parishes) ──────────
  .get("/categories", async (c) => c.json(await c.get("db").select().from(categories)))
  .post("/categories", zValidator("json", z.object({ kind: z.enum(["recette", "depense", "banque"]), name: z.string().min(1), group: z.string().optional(), fundId: z.string().uuid().optional(), requiresDepartment: z.boolean().optional() })), async (c) => {
    requireAdmin(c);
    const [cat] = await c.get("db").insert(categories).values(c.req.valid("json")).returning();
    await c.get("db").transaction((tx) => audit(tx, { actorId: c.get("user").id, action: "category.create", entity: "category", entityId: cat!.id, after: cat }));
    return c.json(cat, 201);
  })
  .patch("/categories/:id", zValidator("json", z.object({ name: z.string().min(1).optional(), group: z.string().optional(), active: z.boolean().optional() })), async (c) => {
    requireAdmin(c);
    const [cat] = await c.get("db").update(categories).set(c.req.valid("json")).where(eq(categories.id, c.req.param("id"))).returning();
    await c.get("db").transaction((tx) => audit(tx, { actorId: c.get("user").id, action: "category.update", entity: "category", entityId: cat!.id, after: cat }));
    return c.json(cat);
  })
  .get("/funds", async (c) => c.json(await c.get("db").select().from(funds)))

  // ── Exchange rate (single global rate, history kept) ─────
  .get("/exchange-rates", async (c) => c.json(await c.get("db").select().from(exchangeRates).orderBy(desc(exchangeRates.effectiveFrom), desc(exchangeRates.createdAt))))
  .post("/exchange-rates", zValidator("json", exchangeRateSchema), async (c) => {
    requireAdmin(c);
    const b = c.req.valid("json");
    const [r] = await c.get("db").insert(exchangeRates).values({ ...b, setBy: c.get("user").id }).returning();
    await c.get("db").transaction((tx) => audit(tx, { actorId: c.get("user").id, action: "fx.set", entity: "exchange_rate", entityId: r!.id, after: r }));
    const all = await c.get("db").select({ email: users.email }).from(users).where(eq(users.active, true));
    await safeSend(c.get("mailer"), all.map((u) => ({ to: u.email, ...rateChanged({ rate: b.rateCdfPerUsd, effectiveFrom: b.effectiveFrom }) })));
    return c.json(r, 201);
  })

  // ── Users (Administrateur) ───────────────────────────────
  .get("/users", async (c) => {
    requireAdmin(c);
    const mine = adminParishes(c);
    const rows = await c.get("db").select({ user: users, role: userParishRoles }).from(users)
      .innerJoin(userParishRoles, eq(userParishRoles.userId, users.id)).where(inArray(userParishRoles.parishId, mine));
    const byUser = new Map<string, any>();
    for (const r of rows) {
      const u = byUser.get(r.user.id) ?? { ...r.user, roles: [] };
      u.roles.push({ parishId: r.role.parishId, role: r.role.role, consolidatedAccess: r.role.consolidatedAccess });
      byUser.set(r.user.id, u);
    }
    return c.json([...byUser.values()]);
  })
  .post("/users", zValidator("json", userCreateSchema), async (c) => {
    requireAdmin(c);
    const b = c.req.valid("json");
    const mine = adminParishes(c);
    assertRoles(b.roles, mine);
    const auth0Id = await createAuth0User(c.env, b.email, b.fullName);
    const [u] = await c.get("db").insert(users).values({ auth0Id, email: b.email, fullName: b.fullName }).returning();
    await c.get("db").insert(userParishRoles).values(b.roles.map((r) => ({ userId: u!.id, parishId: r.parishId, role: r.role, consolidatedAccess: r.consolidatedAccess })));
    await c.get("db").transaction((tx) => audit(tx, { actorId: c.get("user").id, action: "user.create", entity: "user", entityId: u!.id, after: { ...u, roles: b.roles } }));
    const link = await passwordSetLink(c.env, auth0Id);
    await safeSend(c.get("mailer"), [{ to: b.email, ...invitation({ fullName: b.fullName, link, appUrl: c.env.APP_URL }) }]);
    return c.json(u, 201);
  })
  .put("/users/:id/roles", zValidator("json", userCreateSchema.pick({ roles: true })), async (c) => {
    requireAdmin(c);
    const { roles } = c.req.valid("json");
    const mine = adminParishes(c);
    assertRoles(roles, mine);
    const id = c.req.param("id");
    // Replace only the assignments in parishes the caller administers.
    await c.get("db").transaction(async (tx) => {
      const before = await tx.select().from(userParishRoles).where(and(eq(userParishRoles.userId, id), inArray(userParishRoles.parishId, mine)));
      await tx.delete(userParishRoles).where(and(eq(userParishRoles.userId, id), inArray(userParishRoles.parishId, mine)));
      await tx.insert(userParishRoles).values(roles.map((r) => ({ userId: id, parishId: r.parishId, role: r.role, consolidatedAccess: r.consolidatedAccess })));
      await audit(tx, { actorId: c.get("user").id, action: "user.roles", entity: "user", entityId: id, before, after: roles });
    });
    await alertAdmins(c, `Les profils d'un utilisateur ont été modifiés par ${c.get("user").fullName}.`);
    return c.json({ ok: true });
  })
  .post("/users/:id/:state{deactivate|activate}", async (c) => {
    requireAdmin(c);
    const id = c.req.param("id");
    const active = c.req.param("state") === "activate";
    if (id === c.get("user").id && !active) throw new HTTPException(422, { message: "Vous ne pouvez pas vous désactiver" });
    const [u] = await c.get("db").update(users).set({ active }).where(eq(users.id, id)).returning();
    if (!u) throw new HTTPException(404);
    await setAuth0Blocked(c.env, u.auth0Id, !active); // block in Auth0 and in users at once
    await c.get("db").transaction((tx) => audit(tx, { actorId: c.get("user").id, action: active ? "user.activate" : "user.deactivate", entity: "user", entityId: id }));
    if (!active) await alertAdmins(c, `${u.fullName} a été désactivé par ${c.get("user").fullName}.`);
    return c.json({ ok: true });
  })

  // ── Parish-scoped configuration ──────────────────────────
  .use("/accounts", parishScope).use("/accounts/*", parishScope)
  .use("/departments", parishScope).use("/audit", parishScope)
  .get("/accounts", async (c) => c.json(await run(c, (tx) => tx.select().from(accounts))))
  .post("/accounts", requirePerm("config.manage"), zValidator("json", accountSchema), async (c) => {
    const b = c.req.valid("json");
    if (b.parishId !== c.get("parishId")) throw new HTTPException(400, { message: "Paroisse incohérente" });
    return c.json(await run(c, async (tx) => {
      const [a] = await tx.insert(accounts).values(b).returning();
      await audit(tx, { parishId: b.parishId, actorId: c.get("user").id, action: "account.create", entity: "account", entityId: a!.id, after: a });
      return a!;
    }), 201);
  })
  .patch("/accounts/:id", requirePerm("config.manage"), zValidator("json", z.object({ name: z.string().optional(), active: z.boolean().optional() })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [a] = await tx.update(accounts).set(c.req.valid("json")).where(eq(accounts.id, c.req.param("id"))).returning();
      await audit(tx, { parishId: a?.parishId, actorId: c.get("user").id, action: "account.update", entity: "account", entityId: c.req.param("id"), after: a });
      return a;
    })))
  .get("/departments", async (c) => c.json(await run(c, (tx) => tx.select().from(departments))))
  .post("/departments", requirePerm("config.manage"), zValidator("json", z.object({ name: z.string().min(1) })), async (c) =>
    c.json(await run(c, async (tx) => {
      const [d] = await tx.insert(departments).values({ parishId: c.get("parishId")!, name: c.req.valid("json").name }).returning();
      await audit(tx, { parishId: d!.parishId, actorId: c.get("user").id, action: "department.create", entity: "department", entityId: d!.id, after: d });
      return d!;
    }), 201))
  .get("/audit", requirePerm("audit.view"), async (c) => {
    const db = c.get("db");
    // Global entries (users, categories, exchange rate) carry no parish: Administrateurs see them too.
    const scope = c.get("roles").includes("administrateur")
      ? or(inArray(auditLog.parishId, c.get("parishIds")), isNull(auditLog.parishId))
      : inArray(auditLog.parishId, c.get("parishIds"));
    const rows = await db.select({ log: auditLog, actorName: users.fullName, actorEmail: users.email })
      .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId)).where(scope).orderBy(desc(auditLog.at)).limit(500);
    // For actions on a user, also resolve who it was about.
    const targetIds = [...new Set(rows.filter((r) => r.log.entity === "user" && r.log.entityId).map((r) => r.log.entityId!))];
    const targets = targetIds.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, targetIds)) : [];
    const nameOf = new Map(targets.map((t) => [t.id, t.fullName]));
    return c.json(rows.map((r) => ({ ...r.log, actorName: r.actorName, actorEmail: r.actorEmail, targetName: r.log.entity === "user" ? nameOf.get(r.log.entityId ?? "") ?? null : null })));
  });

function assertRoles(roles: Array<{ parishId: string; role: Role }>, adminOf: string[]) {
  const byParish = new Map<string, Role[]>();
  for (const r of roles) {
    if (!adminOf.includes(r.parishId)) throw new HTTPException(403, { message: "Paroisse non administrée" });
    byParish.set(r.parishId, [...(byParish.get(r.parishId) ?? []), r.role]);
  }
  for (const rs of byParish.values()) {
    const conflict = findRoleConflict(rs);
    if (conflict) throw new HTTPException(422, { message: `Profils incompatibles dans une même paroisse: ${conflict.join(" + ")}` });
  }
}

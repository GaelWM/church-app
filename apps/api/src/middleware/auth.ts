import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { parishes, userParishRoles, users } from "@church/db";
import { can, type Permission, type Role } from "@church/shared";
import type { AppEnv, Bindings, Deps } from "../env";
import { devAuthEnabled } from "../services/dev";

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAuth0Token(token: string, env: Bindings): Promise<{ sub: string }> {
  const issuer = `https://${env.AUTH0_DOMAIN}/`;
  if (!jwks.has(issuer)) jwks.set(issuer, createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`)));
  const { payload } = await jwtVerify(token, jwks.get(issuer)!, { issuer, audience: env.AUTH0_AUDIENCE });
  if (!payload.sub) throw new Error("no sub");
  return { sub: payload.sub };
}

/** 1) verify token 2) find active user (403 if not configured) 3) load memberships. */
export const authenticate = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new HTTPException(401, { message: "Jeton manquant" });
    let sub: string;
    try {
      if (devAuthEnabled(c.env) && token.startsWith("dev:")) sub = token.slice(4);
      else sub = (await (deps.verifyToken ?? verifyAuth0Token)(token, c.env)).sub;
    } catch {
      throw new HTTPException(401, { message: "Jeton invalide" });
    }
    const db = c.get("db");
    const [user] = await db.select().from(users).where(eq(users.auth0Id, sub));
    if (!user || !user.active) throw new HTTPException(403, { message: "not_configured" });
    const rows = await db.select({ parishId: userParishRoles.parishId, role: userParishRoles.role, consolidatedAccess: userParishRoles.consolidatedAccess })
      .from(userParishRoles).innerJoin(parishes, eq(parishes.id, userParishRoles.parishId))
      .where(eq(userParishRoles.userId, user.id));
    c.set("auth0Id", sub);
    c.set("user", { id: user.id, email: user.email, fullName: user.fullName });
    c.set("memberships", rows.map((r) => ({ ...r, role: r.role as Role })));
    await next();
  });

/**
 * Parish scope from `x-parish-id`. "all" requires consolidated access and is read-only.
 * Administrateur's parish list (config screens) is resolved the same way.
 */
export const parishScope = createMiddleware<AppEnv>(async (c, next) => {
  const ms = c.get("memberships");
  const wanted = c.req.header("x-parish-id") ?? c.req.query("parishId");
  const own = [...new Set(ms.map((m) => m.parishId))];
  if (wanted === "all") {
    const consolidated = ms.filter((m) => m.consolidatedAccess);
    if (!consolidated.length) throw new HTTPException(403, { message: "Vue consolidée non autorisée" });
    if (c.req.method !== "GET") throw new HTTPException(403, { message: "Vue consolidée en lecture seule" });
    c.set("parishIds", own);
    c.set("parishId", null);
    c.set("roles", [...new Set(consolidated.map((m) => m.role))]);
  } else {
    const id = wanted ?? own[0];
    if (!id || !own.includes(id)) throw new HTTPException(403, { message: "Paroisse non autorisée" });
    c.set("parishIds", [id]);
    c.set("parishId", id);
    c.set("roles", ms.filter((m) => m.parishId === id).map((m) => m.role));
  }
  await next();
});

export const requirePerm = (perm: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.get("roles"), perm)) throw new HTTPException(403, { message: "Permission refusée" });
    await next();
  });

export function requireParish(c: { get: (k: "parishId") => string | null }): string {
  const id = c.get("parishId");
  if (!id) throw new HTTPException(400, { message: "Sélectionnez une paroisse" });
  return id;
}

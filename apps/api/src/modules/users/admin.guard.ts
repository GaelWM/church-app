import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Role } from "@church/shared";
import type { AppEnv } from "../../env";

/** Parishes where the caller is Administrateur. */
export const adminParishes = (c: Context<AppEnv>): string[] =>
  (c.get("memberships") as Array<{ parishId: string; role: Role }>).filter((m) => m.role === "administrateur").map((m) => m.parishId);

export function requireAdmin(c: Context<AppEnv>) {
  if (!adminParishes(c).length) throw new HTTPException(403, { message: "Permission refusée" });
}

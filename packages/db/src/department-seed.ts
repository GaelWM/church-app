import { eq } from "drizzle-orm";
import { DEFAULT_DEPARTMENTS, normalizeDepartmentName } from "@church/shared";
import type { Db, Tx } from "./client";
import { departments } from "./schema";

/**
 * Per-parish default départements. Idempotent: the table has no unique constraint, so the missing names are
 * found by comparing without case or accents. Like seedAssetDefaults, `db` must be scoped to the parish
 * (departments has forced row-level security) unless the role bypasses RLS.
 */
export async function seedDepartmentDefaults(db: Db | Tx, parishId: string) {
  const have = new Set((await db.select({ name: departments.name }).from(departments).where(eq(departments.parishId, parishId)))
    .map((d) => normalizeDepartmentName(d.name)));
  const missing = DEFAULT_DEPARTMENTS.filter((name) => !have.has(normalizeDepartmentName(name)));
  if (missing.length) await db.insert(departments).values(missing.map((name) => ({ parishId, name })));
}

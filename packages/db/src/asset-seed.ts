import { DEFAULT_ASSET_LOCATIONS, DEFAULT_ASSET_PREFIXES } from "@church/shared";
import type { Db, Tx } from "./client";
import { assetCodePrefixes, assetLocations } from "./schema";

/**
 * Per-parish defaults of the Immobilisations module: the code acronyms (MB, MT, MI, MO + proposals) and the
 * usual locations. Idempotent. The asset tables have row-level security, so `db` must be a transaction scoped
 * to the parish (withScope, or set_config('app.parish_ids', …, true)) unless the role bypasses RLS.
 */
export async function seedAssetDefaults(db: Db | Tx, parishId: string) {
  await db.insert(assetCodePrefixes).values(DEFAULT_ASSET_PREFIXES.map((p) => ({
    parishId, acronym: p.acronym, label: p.label, subaccountCodes: [...p.subaccountCodes],
  }))).onConflictDoNothing();
  await db.insert(assetLocations).values(DEFAULT_ASSET_LOCATIONS.map((name, i) => ({ parishId, name, sortOrder: i + 1 }))).onConflictDoNothing();
}

import type { Tx } from "@church/db";
import { audit } from "../../services/audit";
import type { z } from "zod";
import { SETTINGS_DEFAULTS, settingsSchema, type ParishSettings } from "./settings.dto";
import * as repo from "./settings.repo";

export type Actor = { userId: string; parishId: string };

/** All settings of a parish with defaults filled in (invalid stored values fall back to the default). */
export async function getSettings(tx: Tx, parishId: string): Promise<ParishSettings> {
  const rows = await repo.listByParish(tx, parishId);
  const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
  for (const r of rows) {
    const shape = (settingsSchema.shape as Record<string, z.ZodType>)[r.key];
    const v = shape?.safeParse(r.value);
    if (v?.success) out[r.key] = v.data;
  }
  return out as ParishSettings;
}

export const get = getSettings;

export async function update(tx: Tx, actor: Actor, patch: Record<string, unknown>) {
  const { parishId, userId } = actor;
  const before = await getSettings(tx, parishId);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const ex = await repo.findByKey(tx, parishId, key);
    if (ex) await repo.update(tx, ex.id, value, userId);
    else await repo.insert(tx, parishId, key, value, userId);
  }
  const after = await getSettings(tx, parishId);
  const keys = Object.keys(patch);
  const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  await audit(tx, { parishId, actorId: userId, action: "settings.update", entity: "settings", before: pick(before), after: pick(after) });
  return after;
}

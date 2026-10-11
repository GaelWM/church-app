import { z } from "zod";
import { ASSET_ETATS } from "@church/shared";

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const createInventorySchema = z.object({
  /** Limit the inventory to one location; absent = every location. */
  locationId: uuid.nullish().transform((v) => v ?? null),
  observations: optText(1000),
}).strict();

/** Checking one line of the théorique. A "present" line with nothing else means: found where and as the register says. */
export const checkLineSchema = z.object({
  present: z.boolean(),
  foundLocationId: uuid.nullish().transform((v) => v ?? null),
  foundEtat: z.enum(ASSET_ETATS).nullish().transform((v) => v ?? null),
  responsible: optText(200),
  observation: optText(500),
}).strict();

/** Something found that is not in the register. */
export const foundLineSchema = z.object({
  description: z.string().trim().min(1, "Description requise").max(200),
  foundLocationId: uuid,
  foundEtat: z.enum(ASSET_ETATS).default("bon"),
  responsible: optText(200),
  observation: optText(500),
}).strict();

export type CreateInventory = z.infer<typeof createInventorySchema>;
export type CheckLine = z.infer<typeof checkLineSchema>;
export type FoundLine = z.infer<typeof foundLineSchema>;

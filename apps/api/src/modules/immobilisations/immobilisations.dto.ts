import { z } from "zod";
import { ASSET_TYPES, CURRENCIES, pastDate } from "@church/shared";

const uuid = z.string().uuid();
const amountMinor = z.coerce.bigint().positive();
const optText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/**
 * Only "lineaire" is accepted right now, even though the DB column and the shared enum both allow
 * "degressif": the declining-balance coefficient rules haven't been confirmed with the client, so we
 * never silently compute it wrong. The web form shows "Dégressif" as a disabled "bientôt disponible" option.
 */
export const assetSchema = z.object({
  type: z.enum(ASSET_TYPES),
  name: z.string().trim().min(1, "Nom requis").max(200),
  registeredAt: pastDate.optional(),
  acquisitionDate: pastDate,
  currency: z.enum(CURRENCIES),
  amountMinor,
  invoiceNumber: optText(100),
  // Required unless type === "terrain" — enforced server-side in the service (422), not here, so the
  // error surfaces the same way as the other cross-field business rules in this codebase.
  usefulLifeYears: z.coerce.number().int().min(1).max(100).optional(),
  depreciationMethod: z.literal("lineaire").default("lineaire"),
  condition: optText(200),
  location: optText(200),
  transactionId: uuid.optional(),
});
export type AssetInput = z.infer<typeof assetSchema>;

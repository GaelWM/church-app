import { z } from "zod";
import { pastDate } from "@church/shared";

const uuid = z.string().uuid();
const amount = z.coerce.bigint().positive();

export const bankOpSchema = z.discriminatedUnion("type", [
  // Two-leg moves between accounts of the same currency.
  z.object({ type: z.enum(["versement", "retrait", "virement"]), fromAccountId: uuid, toAccountId: uuid, date: pastDate, amountMinor: amount, description: z.string().optional() }),
  // Currency exchange at the actual rate obtained ("1 USD = X CDF").
  z.object({ type: z.literal("change"), fromAccountId: uuid, toAccountId: uuid, date: pastDate, amountMinor: amount, actualRateCdfPerUsd: z.string().regex(/^\d+(\.\d{1,4})?$/), description: z.string().optional() }),
  // Single-leg bank movements.
  z.object({ type: z.enum(["frais", "interets"]), accountId: uuid, date: pastDate, amountMinor: amount, description: z.string().optional(),
    // Frais: tenue de compte / retrait bancaire / retrait mobile money each have their own category.
    feeType: z.enum(["tenue_compte", "retrait_bancaire", "retrait_mobile_money"]).optional() }),
]);
export type BankOpInput = z.infer<typeof bankOpSchema>;

export const reconciliationQuerySchema = z.object({ accountId: uuid, year: z.coerce.number(), month: z.coerce.number() });
export type ReconciliationQuery = z.infer<typeof reconciliationQuerySchema>;

export const reconcileSchema = z.object({ ids: z.array(uuid).min(1), matched: z.boolean() });
export type ReconcileInput = z.infer<typeof reconcileSchema>;

export const closePeriodSchema = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) });
export type ClosePeriodInput = z.infer<typeof closePeriodSchema>;

import { z } from "zod";
import { ACCOUNT_TYPES, CURRENCIES, ROLES } from "./enums";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * ISO date that must be a real calendar day inside [now - pastYears, now + futureDays]. The windows are wider than the
 * date pickers in the web app (which enforce the tighter, per-field UX limits), so the UI can never produce a rejected date;
 * the extra day of future slack covers users whose local date is already "tomorrow" in UTC.
 */
const boundedDate = (pastYears: number, futureDays: number) => isoDate.refine((s) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return false; // e.g. 2026-02-31
  const now = Date.now();
  return t >= now - pastYears * 366 * 86_400_000 && t <= now + futureDays * 86_400_000;
}, "Date hors de la période autorisée");
/** Something that already happened (entry, bank operation, service). */
export const pastDate = boundedDate(10, 1);
/** A due date: may be overdue, can be planned a few years ahead. */
export const dueDate = boundedDate(2, 6 * 366);
/** A rate or setting taking effect: can be backdated, scheduled about a month ahead. */
export const effectiveDate = boundedDate(10, 32);
const amountMinor = z.coerce.bigint().positive();

export const parishSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(2).max(10),
  city: z.string().optional(),
});

export const userCreateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  roles: z.array(z.object({ parishId: uuid, role: z.enum(ROLES), consolidatedAccess: z.boolean().default(false) })).min(1),
});

export const accountSchema = z.object({
  parishId: uuid,
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES),
  name: z.string().min(1),
  bankName: z.string().optional(),
  number: z.string().optional(),
});

export const exchangeRateSchema = z.object({
  rateCdfPerUsd: z.string().regex(/^\d+(\.\d{1,4})?$/),
  effectiveFrom: effectiveDate,
});

export const transactionInputSchema = z.object({
  parishId: uuid,
  kind: z.enum(["recette", "depense"]),
  accountId: uuid,
  categoryId: uuid,
  date: pastDate,
  amountMinor,
  reference: z.string().optional(),
  description: z.string().optional(),
  beneficiary: z.string().optional(),
  documentNumber: z.string().optional(),
  departmentId: uuid.optional(),
  memberId: uuid.optional(),
  pledgeId: uuid.optional(),
});

export const rejectSchema = z.object({ comment: z.string().min(1) });
export const batchActionSchema = z.object({ ids: z.array(uuid).min(1) });

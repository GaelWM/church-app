import { z } from "zod";
import { ACCOUNT_TYPES, CURRENCIES, ROLES } from "./enums";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
  effectiveFrom: isoDate,
});

export const transactionInputSchema = z.object({
  parishId: uuid,
  kind: z.enum(["recette", "depense"]),
  accountId: uuid,
  categoryId: uuid,
  date: isoDate,
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

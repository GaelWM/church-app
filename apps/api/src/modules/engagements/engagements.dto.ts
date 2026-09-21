import { z } from "zod";
import { CURRENCIES, ENGAGEMENT_TYPES, dueDate, pastDate } from "@church/shared";

const uuid = z.string().uuid();
const amount = z.coerce.bigint().positive();

export const pledgeSchema = z.object({
  memberId: uuid.optional(), donorName: z.string().optional(), categoryId: uuid, currency: z.enum(CURRENCIES), amountMinor: amount, dueDate: dueDate.optional(),
  type: z.enum(ENGAGEMENT_TYPES).default("autre"), beneficiary: z.string().trim().min(1).optional(),
});
export type PledgeInput = z.infer<typeof pledgeSchema>;

export const commitmentSchema = z.object({
  categoryId: uuid, payee: z.string().min(1), currency: z.enum(CURRENCIES), amountMinor: amount, dueDate: dueDate.optional(),
  type: z.enum(ENGAGEMENT_TYPES).default("autre"),
});
export type CommitmentInput = z.infer<typeof commitmentSchema>;

export const commitmentPaidSchema = z.object({ transactionId: uuid });
export type CommitmentPaidInput = z.infer<typeof commitmentPaidSchema>;

export const releaseSchema = z.object({
  date: pastDate, amountMinor: amount, accountId: uuid.optional(), transactionId: uuid.optional(), note: z.string().trim().max(500).optional(),
});
export type ReleaseInput = z.infer<typeof releaseSchema>;

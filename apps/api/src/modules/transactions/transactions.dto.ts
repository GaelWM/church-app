import { z } from "zod";
import { batchActionSchema, transactionInputSchema } from "@church/shared";

export const filterSchema = z.object({
  kind: z.string().optional(), status: z.string().optional(), accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(), currency: z.string().optional(), enteredBy: z.string().uuid().optional(),
  from: z.string().optional(), to: z.string().optional(),
  validatorId: z.string().uuid().optional(), q: z.string().optional(),
});
export type Filters = z.infer<typeof filterSchema>;

export const balanceQuerySchema = z.object({ accountId: z.string().uuid() });
export type BalanceQuery = z.infer<typeof balanceQuerySchema>;

export const transactionPatchSchema = transactionInputSchema.partial();
export type TransactionPatchInput = z.infer<typeof transactionPatchSchema>;
export type TransactionCreateInput = z.infer<typeof transactionInputSchema>;

export const batchBodySchema = batchActionSchema.extend({ comment: z.string().optional() });
export type BatchBody = z.infer<typeof batchBodySchema>;

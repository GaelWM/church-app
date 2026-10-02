import { z } from "zod";
import { BUDGET_PERIODS, CURRENCIES, INVESTMENT_TYPES, type BudgetPeriod } from "@church/shared";

const uuid = z.string().uuid();
const amount = z.coerce.bigint().positive();

export const yearSchema = z.coerce.number().int().min(2000).max(2100);
export const yearQuerySchema = z.object({ year: yearSchema });
export type YearQuery = z.infer<typeof yearQuerySchema>;

/** Valid periodIndex range per period: annuel is always 0, trimestriel T1-T4 (1-4), mensuel 1-12. */
export function periodIndexRange(period: BudgetPeriod): readonly [number, number] {
  return period === "annuel" ? [0, 0] : period === "trimestriel" ? [1, 4] : [1, 12];
}

const expenseLineBase = z.object({
  year: yearSchema,
  categoryId: uuid,
  period: z.enum(BUDGET_PERIODS).default("annuel"),
  periodIndex: z.coerce.number().int().min(0).max(12).default(0),
  currency: z.enum(CURRENCIES),
  amountMinor: amount,
  observation: z.string().trim().max(500).optional(),
});

export const expenseLineSchema = expenseLineBase.superRefine((v, ctx) => {
  const [min, max] = periodIndexRange(v.period);
  if (v.periodIndex < min || v.periodIndex > max) {
    ctx.addIssue({ code: "custom", path: ["periodIndex"], message: "periodIndex incohérent avec la période (annuel : 0, trimestriel : 1-4, mensuel : 1-12)" });
  }
});
export type ExpenseLineInput = z.infer<typeof expenseLineSchema>;

export const expenseLinePatchSchema = expenseLineBase.partial();
export type ExpenseLinePatchInput = z.infer<typeof expenseLinePatchSchema>;

export const investmentSchema = z.object({
  year: yearSchema,
  name: z.string().trim().min(1, "Nom du projet requis"),
  type: z.enum(INVESTMENT_TYPES).default("autre"),
  currency: z.enum(CURRENCIES),
  amountMinor: amount,
  observation: z.string().trim().max(500).optional(),
  active: z.boolean().default(true),
});
export type InvestmentInput = z.infer<typeof investmentSchema>;

export const investmentPatchSchema = investmentSchema.partial();
export type InvestmentPatchInput = z.infer<typeof investmentPatchSchema>;

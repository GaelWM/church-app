import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { BUDGET_PERIODS, BUDGET_PERIOD_LABELS, CURRENCIES, parseAmount } from "@church/shared";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-controls";
import { ErrorNote, Field, FormFooter, FormGrid } from "@/components/common";
import { useApi } from "../../core/api";
import { amountField, requiredSelect } from "../../core/forms";
import { useCategories, useInvalidateLedger } from "../../core/queries";
import type { ExpenseLine } from "./types";

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1).padStart(2, "0") }));
const QUARTERS = [1, 2, 3, 4].map((q) => ({ value: String(q), label: `T${q}` }));

/** Exact minor units -> "1234,56" for the amount input (no float). */
const exactAmount = (minor: string) => { const s = BigInt(minor).toString().padStart(3, "0"); return `${s.slice(0, -2)},${s.slice(-2)}`; };

const schema = z.object({
  categoryId: requiredSelect("Catégorie requise"),
  period: z.enum(BUDGET_PERIODS),
  periodIndex: z.string().optional(),
  year: z.string().min(4, "Année requise"),
  currency: z.enum(CURRENCIES),
  amount: amountField,
  observation: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.period !== "annuel" && !v.periodIndex) {
    ctx.addIssue({ code: "custom", path: ["periodIndex"], message: v.period === "trimestriel" ? "Trimestre requis" : "Mois requis" });
  }
});
type FormValues = z.infer<typeof schema>;

export function ExpenseLineForm({ year, editing, onClose }: { year: number; editing: ExpenseLine | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const depenses = useCategories("depense");
  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? {
          categoryId: editing.categoryId, period: editing.period, periodIndex: editing.periodIndex ? String(editing.periodIndex) : "",
          year: String(editing.year), currency: editing.currency, amount: exactAmount(editing.amountMinor), observation: editing.observation ?? "",
        }
      : { categoryId: "", period: "annuel", periodIndex: "", year: String(year), currency: "CDF", amount: "", observation: "" },
  });
  const period = watch("period");
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        year: Number(v.year), categoryId: v.categoryId, period: v.period,
        periodIndex: v.period === "annuel" ? 0 : Number(v.periodIndex), currency: v.currency,
        amountMinor: parseAmount(v.amount).toString(), observation: v.observation?.trim() || undefined,
      };
      return editing ? api.patch(`/budget/expenses/${editing.id}`, body) : api.post("/budget/expenses", body);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <FormGrid>
        <div className="col-span-full">
          <Field label="Catégorie" error={errors.categoryId?.message}>
            <FormSelect control={control} name="categoryId" options={[{ value: "", label: "—" }, ...(depenses.data ?? []).map((c) => ({ value: c.id, label: <>{c.group ? `${c.group} · ` : ""}{c.name}</> }))]} />
          </Field>
        </div>
        <Field label="Période"><FormSelect control={control} name="period" options={BUDGET_PERIODS.map((p) => ({ value: p, label: BUDGET_PERIOD_LABELS[p] }))} /></Field>
        {period === "trimestriel" && <Field label="Trimestre" error={errors.periodIndex?.message}><FormSelect control={control} name="periodIndex" options={[{ value: "", label: "—" }, ...QUARTERS]} /></Field>}
        {period === "mensuel" && <Field label="Mois" error={errors.periodIndex?.message}><FormSelect control={control} name="periodIndex" options={[{ value: "", label: "—" }, ...MONTHS]} /></Field>}
        <Field label="Année" error={errors.year?.message}><Input inputMode="numeric" {...register("year")} /></Field>
        <Field label="Devise"><FormSelect control={control} name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Prévisionnel annuel" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        <div className="col-span-full"><Field label="Observation"><Input {...register("observation")} /></Field></div>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

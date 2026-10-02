import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { CURRENCIES, INVESTMENT_TYPES, INVESTMENT_TYPE_LABELS, parseAmount } from "@church/shared";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/form-controls";
import { ErrorNote, Field, FormFooter, FormGrid } from "@/components/common";
import { useApi } from "../../core/api";
import { amountField } from "../../core/forms";
import { useInvalidateLedger } from "../../core/queries";
import type { Investment } from "./types";

/** Exact minor units -> "1234,56" for the amount input (no float). */
const exactAmount = (minor: string) => { const s = BigInt(minor).toString().padStart(3, "0"); return `${s.slice(0, -2)},${s.slice(-2)}`; };

const schema = z.object({
  name: z.string().trim().min(1, "Nom du projet requis"),
  type: z.enum(INVESTMENT_TYPES),
  year: z.string().min(4, "Année requise"),
  currency: z.enum(CURRENCIES),
  amount: amountField,
  observation: z.string().optional(),
  active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function InvestmentForm({ year, editing, onClose }: { year: number; editing: Investment | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? { name: editing.name, type: editing.type, year: String(editing.year), currency: editing.currency, amount: exactAmount(editing.amountMinor), observation: editing.observation ?? "", active: editing.active }
      : { name: "", type: "autre", year: String(year), currency: "CDF", amount: "", observation: "", active: true },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        year: Number(v.year), name: v.name.trim(), type: v.type, currency: v.currency,
        amountMinor: parseAmount(v.amount).toString(), observation: v.observation?.trim() || undefined, active: v.active,
      };
      return editing ? api.patch(`/budget/investments/${editing.id}`, body) : api.post("/budget/investments", body);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <FormGrid>
        <div className="col-span-full"><Field label="Nom du projet" error={errors.name?.message}><Input {...register("name")} /></Field></div>
        <Field label="Type"><FormSelect control={control} name="type" options={INVESTMENT_TYPES.map((t) => ({ value: t, label: INVESTMENT_TYPE_LABELS[t] }))} /></Field>
        <Field label="Année" error={errors.year?.message}><Input inputMode="numeric" {...register("year")} /></Field>
        <Field label="Devise"><FormSelect control={control} name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Prévisionnel" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        <div className="col-span-full"><Field label="Observation"><Input {...register("observation")} /></Field></div>
        <div className="col-span-full">
          <Controller
            control={control} name="active"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} />
                Projet actif (apparaît dans la liste des projets sélectionnables pour une dépense)
              </label>
            )}
          />
        </div>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

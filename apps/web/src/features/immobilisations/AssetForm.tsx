import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ASSET_TYPES, ASSET_TYPE_LABELS, CURRENCIES, parseAmount } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, ErrorNote, Field, FormFooter, FormGrid } from "@/components/common";
import { FormDate, FormSelect, dateLimits } from "@/components/form-controls";
import { amountField } from "../../core/forms";
import { useApi } from "../../core/api";
import { fmtDate, money, today } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import type { Tx } from "../../core/types";
import type { Asset } from "./AssetListTab";

const schema = z.object({
  type: z.enum(ASSET_TYPES),
  name: z.string().trim().min(1, "Nom requis"),
  acquisitionDate: z.string().min(1, "Date requise"),
  currency: z.enum(CURRENCIES),
  amount: amountField,
  invoiceNumber: z.string().optional(),
  usefulLifeYears: z.string().optional(),
  condition: z.string().optional(),
  location: z.string().optional(),
  transactionId: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.type !== "terrain" && !v.usefulLifeYears) ctx.addIssue({ code: "custom", path: ["usefulLifeYears"], message: "Durée d'utilité requise (sauf pour un terrain)" });
});
type Values = z.infer<typeof schema>;

/** bigint minor units -> exact decimal string for the amount input (never via float division). */
const exactAmount = (minor: string) => { const s = BigInt(minor).toString().padStart(3, "0"); return `${s.slice(0, -2)},${s.slice(-2)}`; };

/** Validated dépenses: the only transactions an asset's acquisition may link to. A value already stored stays selectable. */
function useDepenseOptions(current?: string | null) {
  const api = useApi();
  const q = useQuery({ queryKey: useScopedKey("depenses-validees"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "depense", status: "validee" }), staleTime: 60_000 });
  const opts = [{ value: "", label: "—" }, ...(q.data ?? []).map((t) => ({
    value: t.id, label: `${fmtDate(t.date)} · ${money(t.amountMinor, t.currency)} · ${t.beneficiary ?? t.description ?? t.reference}`,
  }))];
  if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: `Écriture ${current.slice(0, 8)}…` });
  return opts;
}

export function AssetForm({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: asset ? {
      type: asset.type, name: asset.name, acquisitionDate: asset.acquisitionDate, currency: asset.currency,
      amount: exactAmount(asset.amountMinor), invoiceNumber: asset.invoiceNumber ?? "",
      usefulLifeYears: asset.usefulLifeYears ? String(asset.usefulLifeYears) : "", condition: asset.condition ?? "",
      location: asset.location ?? "", transactionId: asset.transactionId ?? "",
    } : { type: "mobilier", name: "", acquisitionDate: today(), currency: "CDF", amount: "", usefulLifeYears: "5" },
  });
  const type = watch("type");
  const isTerrain = type === "terrain";
  const depenseOptions = useDepenseOptions(asset?.transactionId);
  const save = useMutation({
    mutationFn: (v: Values) => {
      const payload = {
        type: v.type, name: v.name, acquisitionDate: v.acquisitionDate, currency: v.currency, amountMinor: parseAmount(v.amount).toString(),
        invoiceNumber: v.invoiceNumber || undefined, usefulLifeYears: isTerrain ? undefined : v.usefulLifeYears ? Number(v.usefulLifeYears) : undefined,
        depreciationMethod: "lineaire" as const, condition: v.condition || undefined, location: v.location || undefined, transactionId: v.transactionId || undefined,
      };
      return asset ? api.patch(`/immobilisations/${asset.id}`, payload) : api.post("/immobilisations", payload);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Type"><FormSelect control={control} name="type" options={ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }))} /></Field>
        <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
        <Field label="Date d'acquisition" error={errors.acquisitionDate?.message}><FormDate control={control} name="acquisitionDate" {...dateLimits.past()} /></Field>
        <Field label="Devise"><FormSelect control={control} name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Montant" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        <Field label="N° Facture"><Input {...register("invoiceNumber")} /></Field>
        <Field label="Durée d'amortissement (années)" error={errors.usefulLifeYears?.message}>
          <Input type="number" min={1} max={100} disabled={isTerrain} {...register("usefulLifeYears")} placeholder={isTerrain ? "N/A (terrain)" : undefined} />
        </Field>
        <Field label="Mode d'amortissement">
          {/* Only "lineaire" is wired up server-side; "degressif" is shown but disabled until the coefficient rules are confirmed with the client. */}
          <Select value="lineaire" disabled>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lineaire">Linéaire</SelectItem>
              <SelectItem value="degressif" disabled>Dégressif (bientôt disponible)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="État"><Input {...register("condition")} /></Field>
        <Field label="Localisation"><Input {...register("location")} /></Field>
        <div className="col-span-full">
          <Field label="Dépense d'acquisition (optionnel)"><FormSelect control={control} name="transactionId" options={depenseOptions} /></Field>
        </div>
      </FormGrid>
      {isTerrain && <Card className="mt-3"><p className="muted text-sm">Un terrain ne s'amortit pas : aucune durée n'est enregistrée.</p></Card>}
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { ASSET_CURRENCIES, DEPRECIATION_METHODS, DEPRECIATION_METHOD_LABELS, ASSET_CODE_RE, parseAmount } from "@church/shared";
import { Input } from "@/components/ui/input";
import { Banner, ErrorNote, Field, FormFooter, FormGrid, ModalForm } from "@/components/common";
import { FormDate, FormSelect, dateLimits } from "@/components/form-controls";
import { exactAmount } from "@/lib/amount";
import { useApi } from "../../core/api";
import { useInvalidateLedger } from "../../core/queries";
import { useAssetRefs } from "./queries";
import type { Asset } from "./types";

const tryParse = (v: string): bigint | null => { try { return parseAmount(v); } catch { return null; } };
const fx = (v: string) => v.trim().replace(",", ".");

const schema = z.object({
  kind: z.enum(["modification", "annulation"]),
  reason: z.string().trim().min(5, "Motif obligatoire (5 caractères minimum)"),
  description: z.string().trim().min(1, "Description requise"),
  invoiceNumber: z.string(), supplierId: z.string(), locationId: z.string().min(1, "Localisation obligatoire"),
  acquisitionDate: z.string().min(1), inServiceDate: z.string(),
  currency: z.enum(ASSET_CURRENCIES), fxRatePerUsd: z.string(),
  pa: z.string().refine((v) => (tryParse(v) ?? 0n) > 0n, "Montant invalide"),
  faa: z.string().refine((v) => v.trim() === "" || (tryParse(v) ?? -1n) >= 0n, "Montant invalide"),
  method: z.enum(DEPRECIATION_METHODS), usefulLifeYears: z.string(), observations: z.string(),
  code: z.string().refine((v) => v === "" || ASSET_CODE_RE.test(v), "Format attendu : MI 202610 00001"),
});
type Values = z.infer<typeof schema>;

/** "Demander une modification / une annulation" on a validated asset: it changes nothing until the Trésorier and the Pasteur approve. */
export function AssetRequestDialog({ asset, open, onOpenChange, kind: initialKind }: { asset: Asset; open: boolean; onOpenChange: (o: boolean) => void; kind: "modification" | "annulation" }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs(true); // a deactivated location or supplier of the asset must stay selectable
  const init: Omit<Values, "kind" | "reason"> = {
    description: asset.description, invoiceNumber: asset.invoiceNumber ?? "", supplierId: asset.supplierId ?? "", locationId: asset.locationId,
    acquisitionDate: asset.acquisitionDate, inServiceDate: asset.inServiceDate ?? "", currency: asset.currency as Values["currency"],
    fxRatePerUsd: asset.fxRatePerUsd ?? "", pa: exactAmount(asset.paMinor), faa: asset.faaMinor === "0" ? "" : exactAmount(asset.faaMinor),
    method: asset.depreciationMethod, usefulLifeYears: asset.usefulLifeYears ? String(asset.usefulLifeYears) : "", observations: asset.observations ?? "", code: "",
  };
  const { register, control, watch, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema), defaultValues: { kind: initialKind, reason: "", ...init },
  });
  const kind = watch("kind");
  const send = useMutation({
    mutationFn: (v: Values) => {
      if (v.kind === "annulation") return api.post(`/immobilisations/${asset.id}/requests`, { kind: v.kind, reason: v.reason.trim() });
      // Only what differs from the current asset is proposed.
      const c: Record<string, unknown> = {};
      const put = (k: string, now: unknown, before: unknown) => { if ((now ?? null) !== (before ?? null)) c[k] = now; };
      put("description", v.description.trim(), asset.description);
      put("invoiceNumber", v.invoiceNumber.trim() || null, asset.invoiceNumber);
      put("supplierId", v.supplierId || null, asset.supplierId);
      put("locationId", v.locationId, asset.locationId);
      put("acquisitionDate", v.acquisitionDate, asset.acquisitionDate);
      put("inServiceDate", v.inServiceDate || null, asset.inServiceDate);
      put("currency", v.currency, asset.currency);
      put("fxRatePerUsd", v.currency !== "USD" && v.fxRatePerUsd.trim() ? fx(v.fxRatePerUsd) : null, asset.fxRatePerUsd);
      put("paMinor", parseAmount(v.pa).toString(), asset.paMinor);
      put("faaMinor", (v.faa.trim() ? parseAmount(v.faa) : 0n).toString(), asset.faaMinor);
      put("method", v.method, asset.depreciationMethod);
      put("usefulLifeYears", v.method === "non_amortissable" ? null : Number(v.usefulLifeYears) || null, asset.usefulLifeYears);
      put("observations", v.observations.trim() || null, asset.observations);
      if (v.code.trim() && v.code.trim() !== asset.code) c.code = v.code.trim();
      return api.post(`/immobilisations/${asset.id}/requests`, { kind: v.kind, reason: v.reason.trim(), changes: c });
    },
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });
  return (
    <ModalForm open={open} onOpenChange={onOpenChange} className="sm:max-w-2xl"
      title={`${initialKind === "annulation" ? "Demande d'annulation" : "Demande de modification"} · ${asset.code}`}
      description="Une immobilisation validée ne se modifie pas directement : la demande doit être approuvée par le Trésorier puis par le Pasteur. L'immobilisation reste inchangée d'ici là.">
      <form onSubmit={handleSubmit((v) => send.mutate(v))} noValidate className="space-y-3">
        <input type="hidden" {...register("kind")} />
        <Field label="Motif de la demande (obligatoire)" error={errors.reason?.message}>
          <textarea rows={3} autoFocus className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" {...register("reason")} />
        </Field>
        {kind === "annulation" ? (
          <Banner>L'immobilisation ne sera pas supprimée : une fois annulée, elle reste visible dans le registre avec son historique complet.</Banner>
        ) : (
          <FormGrid>
            <div className="col-span-full"><Field label="Description" error={errors.description?.message}><Input {...register("description")} /></Field></div>
            <Field label="N° de facture"><Input {...register("invoiceNumber")} /></Field>
            <Field label="Fournisseur"><FormSelect control={control} name="supplierId" options={[{ value: "", label: "—" }, ...(refs.data?.suppliers ?? []).filter((s) => s.active || s.id === asset.supplierId).map((s) => ({ value: s.id, label: s.name }))]} /></Field>
            <Field label="Localisation" error={errors.locationId?.message}><FormSelect control={control} name="locationId" options={(refs.data?.locations ?? []).filter((l) => l.active || l.id === asset.locationId).map((l) => ({ value: l.id, label: l.name }))} /></Field>
            <Field label="Devise"><FormSelect control={control} name="currency" options={ASSET_CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
            <Field label="Taux de change (1 USD = …)" error={errors.fxRatePerUsd?.message}><Input inputMode="decimal" {...register("fxRatePerUsd")} /></Field>
            <Field label="Date d'acquisition"><FormDate control={control} name="acquisitionDate" {...dateLimits.acquisition()} /></Field>
            <Field label="Date de mise en service"><FormDate control={control} name="inServiceDate" clearable {...dateLimits.inService()} /></Field>
            <Field label="PA — Prix d'achat" error={errors.pa?.message}><Input inputMode="decimal" {...register("pa")} /></Field>
            <Field label="FAA — Frais accessoires" error={errors.faa?.message}><Input inputMode="decimal" {...register("faa")} /></Field>
            <Field label="Mode d'amortissement"><FormSelect control={control} name="method" options={DEPRECIATION_METHODS.map((m) => ({ value: m, label: DEPRECIATION_METHOD_LABELS[m] }))} /></Field>
            <Field label="Durée (années)"><Input type="number" min={1} max={100} {...register("usefulLifeYears")} /></Field>
            <div className="col-span-full"><Field label="Observations"><textarea rows={2} className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" {...register("observations")} /></Field></div>
            <div className="col-span-full">
              <Field label="Nouveau code (exceptionnel, à justifier dans le motif)" error={errors.code?.message}><Input className="font-mono" placeholder={asset.code} {...register("code")} /></Field>
            </div>
          </FormGrid>
        )}
        <ErrorNote error={send.error} />
        <FormFooter pending={send.isPending} onCancel={() => onOpenChange(false)} submitLabel="Envoyer la demande" />
      </form>
    </ModalForm>
  );
}

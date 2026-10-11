import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  amountsAt, ASSET_ACCOUNT_CODES, ASSET_CURRENCIES, ASSET_CURRENCY_LABELS, coefficientFor, codePeriod, defaultModeOf,
  DEPRECIATION_METHOD_LABELS, DEPRECIATION_METHODS, accountDisplay, subaccountBelongsTo, subaccountsOf, parseAmount, rateFor,
  type DepreciationMethod,
} from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote, Field, FormFooter, FormGrid, Money } from "@/components/common";
import { FormDate, FormSelect, OptionSelect, dateLimits } from "@/components/form-controls";
import { exactAmount } from "@/lib/amount";
import { amountField } from "../../core/forms";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import type { Tx } from "../../core/types";
import { useAssetRefs } from "./queries";
import type { Asset } from "./types";

const tryParse = (v: string): bigint | null => { try { return parseAmount(v); } catch { return null; } };
const fxText = (v: string) => v.trim().replace(",", ".");

const schema = z.object({
  accountCode: z.enum(ASSET_ACCOUNT_CODES),
  subaccountCode: z.string().min(1, "Sous-compte requis"),
  acronym: z.string().min(1, "Acronyme requis"),
  description: z.string().trim().min(1, "Description requise"),
  invoiceNumber: z.string(),
  supplierId: z.string(),
  acquisitionDate: z.string().min(1, "Date requise"),
  inServiceDate: z.string(),
  locationId: z.string().min(1, "La localisation est obligatoire"),
  currency: z.enum(ASSET_CURRENCIES),
  fxRatePerUsd: z.string(),
  pa: amountField,
  faa: z.string().refine((v) => v.trim() === "" || (tryParse(v) ?? -1n) >= 0n, "Montant invalide"),
  method: z.enum(DEPRECIATION_METHODS),
  usefulLifeYears: z.string(),
  observations: z.string(),
  transactionId: z.string(),
}).superRefine((v, ctx) => {
  if (v.subaccountCode && !subaccountBelongsTo(v.accountCode, v.subaccountCode))
    ctx.addIssue({ code: "custom", path: ["subaccountCode"], message: "Le sous-compte ne correspond pas au compte" });
  if (v.method !== "non_amortissable") {
    const n = Number(v.usefulLifeYears);
    if (!Number.isInteger(n) || n < 1 || n > 100) ctx.addIssue({ code: "custom", path: ["usefulLifeYears"], message: "Durée requise (1 à 100 ans)" });
    if (!v.inServiceDate) ctx.addIssue({ code: "custom", path: ["inServiceDate"], message: "Date de mise en service requise pour un bien amortissable" });
  }
  if (v.currency !== "USD" && v.fxRatePerUsd.trim() && !(/^\d+(\.\d{1,4})?$/.test(fxText(v.fxRatePerUsd)) && Number(fxText(v.fxRatePerUsd)) > 0))
    ctx.addIssue({ code: "custom", path: ["fxRatePerUsd"], message: "Taux invalide (4 décimales maximum)" });
});
type Values = z.infer<typeof schema>;

/** Validated dépenses: the only transactions an asset's acquisition may link to. A value already stored stays selectable. */
function useDepenseOptions(current?: string | null) {
  const api = useApi();
  const q = useQuery({ queryKey: useScopedKey("depenses-validees"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "depense", status: "validee" }), staleTime: 60_000 });
  const opts = [{ value: "", label: "—" }, ...(q.data ?? []).map((t) => ({
    value: t.id, label: `${fmtDate(t.date)} · ${t.beneficiary ?? t.description ?? t.reference}`,
  }))];
  if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: `Écriture ${current.slice(0, 8)}…` });
  return opts;
}

const defaults = (asset: Asset | null): Values => asset ? {
  accountCode: asset.accountCode as Values["accountCode"], subaccountCode: asset.subaccountCode, acronym: asset.acronym,
  description: asset.description, invoiceNumber: asset.invoiceNumber ?? "", supplierId: asset.supplierId ?? "",
  acquisitionDate: asset.acquisitionDate, inServiceDate: asset.inServiceDate ?? "", locationId: asset.locationId,
  currency: asset.currency as Values["currency"], fxRatePerUsd: asset.fxRatePerUsd ?? "", pa: exactAmount(asset.paMinor),
  faa: asset.faaMinor === "0" ? "" : exactAmount(asset.faaMinor), method: asset.depreciationMethod,
  usefulLifeYears: asset.usefulLifeYears ? String(asset.usefulLifeYears) : "", observations: asset.observations ?? "", transactionId: asset.transactionId ?? "",
} : {
  accountCode: "24", subaccountCode: "24.5", acronym: "MI", description: "", invoiceNumber: "", supplierId: "",
  acquisitionDate: today(), inServiceDate: today(), locationId: "", currency: "USD", fxRatePerUsd: "", pa: "", faa: "",
  method: "lineaire", usefulLifeYears: "5", observations: "", transactionId: "",
};

/** New asset or edit of a draft. A validated asset is never edited here: it goes through a modification request. */
export function AssetForm({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs(true); // inactive entries too: a draft may still point to one that was deactivated since
  const depenseOptions = useDepenseOptions(asset?.transactionId);
  const { register, control, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(asset) });
  const v = watch();
  const [newSupplier, setNewSupplier] = useState<string | null>(null);

  const prefixes = refs.data?.prefixes ?? [];
  const suggestedFirst = useMemo(() => [...prefixes].sort((a, b) =>
    Number(b.subaccountCodes.includes(v.subaccountCode)) - Number(a.subaccountCodes.includes(v.subaccountCode)) || a.acronym.localeCompare(b.acronym)), [prefixes, v.subaccountCode]);
  const nonAmortissable = v.method === "non_amortissable";

  // Live figures: exactly what the server will compute (same shared engine).
  const pa = tryParse(v.pa), faa = v.faa.trim() ? tryParse(v.faa) : 0n;
  const cost = pa !== null && faa !== null ? pa + faa : null;
  // Only a whole number of years is a duration: "5,5" while typing must not reach the engine (it would throw and blank the page).
  const years = /^\d{1,3}$/.test(v.usefulLifeYears.trim()) && Number(v.usefulLifeYears) >= 1 && Number(v.usefulLifeYears) <= 100 ? Number(v.usefulLifeYears) : null;
  const coefficient = v.method === "degressif" && years ? coefficientFor(years, refs.data?.degressiveCoefficients) : null;
  const calc = cost !== null ? amountsAt({ method: v.method, costMinor: cost, years: nonAmortissable ? null : years, inServiceDate: v.inServiceDate || null, coefficient }, today()) : null;
  const rate = rateFor(v.method, nonAmortissable ? null : years, coefficient);

  const onAccount = (code: string, set: (c: string) => void) => {
    set(code);
    const first = subaccountsOf(code)[0];
    if (first) onSubaccount(first.code);
  };
  const onSubaccount = (code: string) => {
    setValue("subaccountCode", code, { shouldValidate: false });
    const mode = defaultModeOf(code);
    setValue("method", mode);
    if (mode === "non_amortissable") { setValue("usefulLifeYears", ""); }
    else if (!getValues("usefulLifeYears")) setValue("usefulLifeYears", "5");
    const suggestion = prefixes.find((p) => p.subaccountCodes.includes(code));
    if (suggestion && !prefixes.some((p) => p.acronym === getValues("acronym") && p.subaccountCodes.includes(code))) setValue("acronym", suggestion.acronym);
  };
  const onMethod = (m: DepreciationMethod) => {
    setValue("method", m);
    if (m === "non_amortissable") setValue("usefulLifeYears", "");
    else if (!getValues("usefulLifeYears")) setValue("usefulLifeYears", "5");
  };
  const onCurrency = (c: string) => {
    setValue("currency", c as Values["currency"]);
    // A rate belongs to its currency: never carry the CDF rate over to EUR. Only CDF has a known rate to suggest.
    setValue("fxRatePerUsd", c === "CDF" && refs.data?.cdfPerUsd ? refs.data.cdfPerUsd : "");
  };

  const addSupplier = useMutation({
    mutationFn: (name: string) => api.post<{ id: string }>("/immobilisations/refs/suppliers", { name }),
    onSuccess: (s) => { invalidate(); setValue("supplierId", s.id); setNewSupplier(null); },
  });
  const save = useMutation({
    mutationFn: (x: Values) => {
      const rate = x.currency !== "USD" && x.fxRatePerUsd.trim() ? fxText(x.fxRatePerUsd) : null;
      const payload = {
        acronym: x.acronym, accountCode: x.accountCode, subaccountCode: x.subaccountCode, description: x.description.trim(),
        invoiceNumber: x.invoiceNumber.trim() || null, supplierId: x.supplierId || null, acquisitionDate: x.acquisitionDate,
        inServiceDate: x.inServiceDate || null, locationId: x.locationId, currency: x.currency, fxRatePerUsd: rate,
        fxRateDate: rate && asset?.fxRatePerUsd === rate ? asset.fxRateDate : undefined,
        paMinor: parseAmount(x.pa).toString(), faaMinor: (x.faa.trim() ? parseAmount(x.faa) : 0n).toString(),
        method: x.method, usefulLifeYears: x.method === "non_amortissable" ? null : Number(x.usefulLifeYears),
        observations: x.observations.trim() || null, transactionId: x.transactionId || null,
      };
      return asset ? api.patch<Asset>(`/immobilisations/${asset.id}`, payload) : api.post<Asset>("/immobilisations", payload);
    },
    onSuccess: (a) => { invalidate(); onClose(); if (!asset) navigate(`/immobilisations/${a.id}`); },
  });

  const codePreview = asset && asset.acronym === v.acronym ? asset.code : `${v.acronym} ${codePeriod()} ·····`;
  return (
    <form onSubmit={handleSubmit((x) => save.mutate(x))} noValidate className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Identification</h3>
        <FormGrid>
          <Field label="Code immobilisation">
            <Input readOnly value={codePreview} className="font-mono" aria-label="Code immobilisation" />
            <small className="text-muted-foreground">{asset ? (asset.acronym === v.acronym ? "Code attribué, non modifiable" : "Un nouveau code sera attribué à l'enregistrement") : "Généré automatiquement à l'enregistrement"}</small>
          </Field>
          <Field label="Acronyme du code" error={errors.acronym?.message}>
            <FormSelect control={control} name="acronym" options={suggestedFirst.filter((p) => p.active || p.acronym === asset?.acronym).map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.label}` }))} />
          </Field>
          <Field label="Type de compte" error={errors.accountCode?.message}>
            <Controller control={control} name="accountCode" render={({ field }) => (
              <OptionSelect value={field.value} onValueChange={(c) => onAccount(c, field.onChange)} options={ASSET_ACCOUNT_CODES.map((c) => ({ value: c, label: accountDisplay(c) }))} />
            )} />
          </Field>
          <Field label="Sous-compte" error={errors.subaccountCode?.message}>
            <OptionSelect value={v.subaccountCode} onValueChange={onSubaccount} placeholder="Choisir…" options={subaccountsOf(v.accountCode).map((s) => ({ value: s.code, label: `${s.code} — ${s.label}` }))} />
          </Field>
          <div className="col-span-full"><Field label="Description" error={errors.description?.message}><Input autoFocus {...register("description")} /></Field></div>
          <Field label="N° de facture"><Input {...register("invoiceNumber")} /></Field>
          <Field label="Fournisseur">
            {newSupplier === null ? (
              <span className="flex gap-2">
                <FormSelect control={control} name="supplierId" options={[{ value: "", label: "—" }, ...(refs.data?.suppliers ?? []).filter((s) => s.active || s.id === asset?.supplierId).map((s) => ({ value: s.id, label: s.name }))]} />
                <Button type="button" variant="outline" size="icon" aria-label="Nouveau fournisseur" onClick={() => setNewSupplier("")}><Plus /></Button>
              </span>
            ) : (
              <span className="flex gap-2">
                <Input autoFocus placeholder="Nom du fournisseur" aria-label="Nom du nouveau fournisseur" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
                <Button type="button" disabled={!newSupplier.trim() || addSupplier.isPending} onClick={() => addSupplier.mutate(newSupplier.trim())}>Ajouter</Button>
                <Button type="button" variant="ghost" onClick={() => setNewSupplier(null)}>Annuler</Button>
              </span>
            )}
          </Field>
          <Field label="Date d'acquisition" error={errors.acquisitionDate?.message}><FormDate control={control} name="acquisitionDate" {...dateLimits.acquisition()} /></Field>
          <Field label="Date de mise en service" error={errors.inServiceDate?.message}><FormDate control={control} name="inServiceDate" clearable {...dateLimits.inService()} /></Field>
          <div className="col-span-full">
            <Field label="Localisation" error={errors.locationId?.message}>
              <FormSelect control={control} name="locationId" placeholder="Où se trouve le bien ?" options={(refs.data?.locations ?? []).filter((l) => l.active || l.id === asset?.locationId).map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
          </div>
        </FormGrid>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Coût d'acquisition</h3>
        <FormGrid>
          <Field label="Devise">
            <OptionSelect value={v.currency} onValueChange={onCurrency} options={ASSET_CURRENCIES.map((c) => ({ value: c, label: ASSET_CURRENCY_LABELS[c] }))} />
          </Field>
          {v.currency !== "USD" && (
            <Field label={`Taux de change (1 USD = … ${v.currency}, optionnel)`} error={errors.fxRatePerUsd?.message}><Input inputMode="decimal" placeholder="ex. 2800" {...register("fxRatePerUsd")} /></Field>
          )}
          <Field label="PA — Prix d'achat" error={errors.pa?.message}><Input inputMode="decimal" placeholder="0,00" {...register("pa")} /></Field>
          <Field label="FAA — Frais accessoires d'achat" error={errors.faa?.message}><Input inputMode="decimal" placeholder="0,00 (transport, installation…)" {...register("faa")} /></Field>
          <div className="col-span-full">
            <Field label="Coût d'acquisition (PA + FAA, calculé)">
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{cost !== null ? <Money value={cost} currency={v.currency} /> : <span className="text-muted-foreground">—</span>}</div>
            </Field>
          </div>
        </FormGrid>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Amortissement</h3>
        <FormGrid>
          <Field label="Mode d'amortissement">
            <OptionSelect value={v.method} onValueChange={(m) => onMethod(m as DepreciationMethod)} options={DEPRECIATION_METHODS.map((m) => ({ value: m, label: DEPRECIATION_METHOD_LABELS[m] }))} />
          </Field>
          <Field label="Durée d'amortissement (années)" error={errors.usefulLifeYears?.message}>
            <Input type="number" min={1} max={100} disabled={nonAmortissable} placeholder={nonAmortissable ? "Non amortissable" : undefined} {...register("usefulLifeYears")} />
          </Field>
          {nonAmortissable ? (
            <div className="col-span-full text-sm text-muted-foreground">Un bien non amortissable n'a ni durée, ni taux, ni amortissement : sa valeur nette comptable reste égale à son coût d'acquisition.</div>
          ) : (
            <>
              <Field label={v.method === "degressif" ? `Taux dégressif (coefficient ${coefficient ?? "—"})` : "Taux (100 ÷ durée)"}>
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{rate !== null ? `${String(rate).replace(".", ",")} %` : "—"}</div>
              </Field>
              <Field label="Valeur amortissable">
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{calc ? <Money value={calc.depreciableMinor} currency={v.currency} /> : "—"}</div>
              </Field>
              <Field label="Amortissement de l'exercice">
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{calc ? <Money value={calc.exerciseMinor} currency={v.currency} /> : "—"}</div>
              </Field>
              <Field label="Amortissement cumulé / VNC à ce jour">
                <div className="flex h-9 items-center gap-3 rounded-md border bg-muted/40 px-3 text-sm">{calc ? <><Money value={calc.accumulatedMinor} currency={v.currency} /><span className="text-muted-foreground">/</span><Money value={calc.vncMinor} currency={v.currency} /></> : "—"}</div>
              </Field>
            </>
          )}
        </FormGrid>
      </section>

      <FormGrid>
        <div className="col-span-full"><Field label="Dépense d'acquisition (optionnel)"><FormSelect control={control} name="transactionId" options={depenseOptions} /></Field></div>
        <div className="col-span-full">
          <Field label="Observations"><textarea rows={2} className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" {...register("observations")} /></Field>
        </div>
      </FormGrid>
      <p className="text-xs text-muted-foreground">L'état initial est « Bon ». L'immobilisation est enregistrée en brouillon ; elle devient active après validation du Trésorier puis du Pasteur. Aucune écriture comptable n'est générée.</p>
      <ErrorNote error={save.error ?? addSupplier.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} submitLabel={asset ? "Enregistrer le brouillon" : "Enregistrer en brouillon"} />
    </form>
  );
}

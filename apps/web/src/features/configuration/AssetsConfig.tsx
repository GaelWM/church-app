import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Tag } from "lucide-react";
import {
  ASSET_ACRONYM_RE, ASSET_SUBACCOUNTS, assetLabelFormatSchema, degressiveCoefficientsSchema, type AssetLabelFormat, type CoefficientBand,
} from "@church/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ActionButton, Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm } from "@/components/common";
import { OptionSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { useInvalidateLedger } from "../../core/queries";
import { useAssetRefs } from "../immobilisations/queries";
import type { Location, Prefix, Supplier } from "../immobilisations/types";

const Active = ({ on }: { on: boolean }) => <span className={on ? "text-success" : "text-muted-foreground"}>{on ? "Actif" : "Désactivé"}</span>;

/** Configuration of the Immobilisations module: the lists a form picks from, and the calculation / printing settings. */
export function AssetsConfig() {
  return (
    <>
      <Prefixes />
      <Locations />
      <Suppliers />
      <Coefficients />
      <LabelFormat />
    </>
  );
}

// ── Code acronyms ────────────────────────────────────────
const prefixSchema = z.object({
  acronym: z.string().regex(ASSET_ACRONYM_RE, "2 à 4 lettres majuscules"),
  label: z.string().trim().min(1, "Libellé requis"),
  subaccountCodes: z.array(z.string()),
  active: z.boolean(),
});
type PrefixValues = z.infer<typeof prefixSchema>;

function Prefixes() {
  const refs = useAssetRefs(true);
  const [edit, setEdit] = useState<Prefix | "new" | null>(null);
  return (
    <>
      <Card title="Acronymes du code immobilisation" actions={<Button size="sm" onClick={() => setEdit("new")}><Plus /> Acronyme</Button>}>
        <p className="text-sm text-muted-foreground">Le code d'une immobilisation est « ACRONYME AAAAMM NNNNN » (ex. MI 202610 00001). Un acronyme ne peut plus être modifié une fois créé : on le désactive.</p>
        <ErrorNote error={refs.error} />
        <DataTable<Prefix> rows={refs.data?.prefixes ?? []} loading={refs.isLoading} emptyIcon={Tag} empty="Aucun acronyme" columns={[
          { header: "Acronyme", cell: (p) => <span className="font-mono font-medium">{p.acronym}</span> },
          { header: "Catégorie", cell: (p) => p.label },
          { header: "Suggéré pour", cell: (p) => p.subaccountCodes.join(", ") || "—" },
          { header: "Statut", cell: (p) => <Active on={p.active} /> },
          { header: "", cell: (p) => <Button size="sm" variant="outline" onClick={() => setEdit(p)}><Pencil />Modifier</Button> },
        ]} />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? "Nouvel acronyme" : `Acronyme ${(edit as Prefix | null)?.acronym ?? ""}`} className="sm:max-w-lg">
        {edit && <PrefixForm prefix={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </ModalForm>
    </>
  );
}

function PrefixForm({ prefix, onClose }: { prefix: Prefix | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<PrefixValues>({
    resolver: zodResolver(prefixSchema),
    defaultValues: { acronym: prefix?.acronym ?? "", label: prefix?.label ?? "", subaccountCodes: prefix?.subaccountCodes ?? [], active: prefix?.active ?? true },
  });
  const save = useMutation({
    mutationFn: (v: PrefixValues) => prefix
      ? api.patch(`/immobilisations/refs/prefixes/${prefix.id}`, { label: v.label.trim(), subaccountCodes: v.subaccountCodes, active: v.active })
      : api.post("/immobilisations/refs/prefixes", { acronym: v.acronym, label: v.label.trim(), subaccountCodes: v.subaccountCodes, active: v.active }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-3">
      <FormGrid>
        <Field label="Acronyme" error={errors.acronym?.message}><Input className="font-mono uppercase" disabled={!!prefix} autoFocus={!prefix} maxLength={4} {...register("acronym", { setValueAs: (v: string) => v.toUpperCase() })} /></Field>
        <Field label="Catégorie (libellé)" error={errors.label?.message}><Input autoFocus={!!prefix} {...register("label")} /></Field>
      </FormGrid>
      <Controller control={control} name="subaccountCodes" render={({ field }) => (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm text-muted-foreground">Proposé automatiquement pour ces sous-comptes</legend>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 text-sm sm:grid-cols-2">
            {ASSET_SUBACCOUNTS.map((s) => (
              <label key={s.code} className="flex items-center gap-2">
                <Checkbox checked={field.value.includes(s.code)} onCheckedChange={(on) => field.onChange(on === true ? [...field.value, s.code] : field.value.filter((c) => c !== s.code))} />
                <span><b>{s.code}</b> {s.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )} />
      {prefix && (
        <Controller control={control} name="active" render={({ field }) => (
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />Actif (proposé dans le formulaire)</label>
        )} />
      )}
      <ErrorNote error={save.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Locations ────────────────────────────────────────────
const locationSchema = z.object({ name: z.string().trim().min(1, "Nom requis"), sortOrder: z.string().regex(/^\d+$/, "Nombre entier"), active: z.boolean() });
type LocationValues = z.infer<typeof locationSchema>;

function Locations() {
  const refs = useAssetRefs(true);
  const [edit, setEdit] = useState<Location | "new" | null>(null);
  return (
    <>
      <Card title="Localisations" actions={<Button size="sm" onClick={() => setEdit("new")}><Plus /> Localisation</Button>}>
        <p className="text-sm text-muted-foreground">Chaque immobilisation a obligatoirement une localisation. Une localisation utilisée n'est jamais supprimée : elle est désactivée.</p>
        <DataTable<Location> rows={refs.data?.locations ?? []} loading={refs.isLoading} empty="Aucune localisation" columns={[
          { header: "Ordre", cell: (l) => l.sortOrder },
          { header: "Nom", cell: (l) => l.name },
          { header: "Statut", cell: (l) => <Active on={l.active} /> },
          { header: "", cell: (l) => <Button size="sm" variant="outline" onClick={() => setEdit(l)}><Pencil />Modifier</Button> },
        ]} />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? "Nouvelle localisation" : "Modifier la localisation"} className="sm:max-w-md">
        {edit && <LocationForm location={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </ModalForm>
    </>
  );
}

function LocationForm({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<LocationValues>({
    resolver: zodResolver(locationSchema), defaultValues: { name: location?.name ?? "", sortOrder: String(location?.sortOrder ?? 0), active: location?.active ?? true },
  });
  const save = useMutation({
    mutationFn: (v: LocationValues) => {
      const body = { name: v.name.trim(), sortOrder: Number(v.sortOrder), active: v.active };
      return location ? api.patch(`/immobilisations/refs/locations/${location.id}`, body) : api.post("/immobilisations/refs/locations", body);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-3">
      <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
      <Field label="Ordre d'affichage" error={errors.sortOrder?.message}><Input inputMode="numeric" {...register("sortOrder")} /></Field>
      {location && <Controller control={control} name="active" render={({ field }) => <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />Active</label>} />}
      <ErrorNote error={save.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Suppliers ────────────────────────────────────────────
const supplierSchema = z.object({ name: z.string().trim().min(1, "Nom requis"), phone: z.string(), address: z.string(), note: z.string(), active: z.boolean() });
type SupplierValues = z.infer<typeof supplierSchema>;

function Suppliers() {
  const refs = useAssetRefs(true);
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  return (
    <>
      <Card title="Fournisseurs" actions={<Button size="sm" onClick={() => setEdit("new")}><Plus /> Fournisseur</Button>}>
        <DataTable<Supplier> rows={refs.data?.suppliers ?? []} loading={refs.isLoading} empty="Aucun fournisseur" pageSize={15} columns={[
          { header: "Nom", cell: (x) => x.name },
          { header: "Téléphone", cell: (x) => x.phone ?? "—" },
          { header: "Adresse", cell: (x) => x.address ?? "—" },
          { header: "Statut", cell: (x) => <Active on={x.active} /> },
          { header: "", cell: (x) => <Button size="sm" variant="outline" onClick={() => setEdit(x)}><Pencil />Modifier</Button> },
        ]} />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? "Nouveau fournisseur" : "Modifier le fournisseur"} className="sm:max-w-md">
        {edit && <SupplierForm supplier={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </ModalForm>
    </>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<SupplierValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { name: supplier?.name ?? "", phone: supplier?.phone ?? "", address: supplier?.address ?? "", note: supplier?.note ?? "", active: supplier?.active ?? true },
  });
  const save = useMutation({
    mutationFn: (v: SupplierValues) => {
      const body = { name: v.name.trim(), phone: v.phone.trim() || null, address: v.address.trim() || null, note: v.note.trim() || null, active: v.active };
      return supplier ? api.patch(`/immobilisations/refs/suppliers/${supplier.id}`, body) : api.post("/immobilisations/refs/suppliers", body);
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-3">
      <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
      <Field label="Téléphone"><Input {...register("phone")} /></Field>
      <Field label="Adresse"><Input {...register("address")} /></Field>
      <Field label="Note"><Input {...register("note")} /></Field>
      {supplier && <Controller control={control} name="active" render={({ field }) => <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />Actif</label>} />}
      <ErrorNote error={save.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Dégressif coefficients ───────────────────────────────
type Row = { min: string; max: string; coef: string };
const toRows = (b: CoefficientBand[]): Row[] => b.map((x) => ({ min: String(x.min), max: x.max === null ? "" : String(x.max), coef: String(x.coef).replace(".", ",") }));

function Coefficients() {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (refs.data) setRows(toRows(refs.data.degressiveCoefficients)); }, [refs.data]);
  const save = useMutation({
    mutationFn: (bands: CoefficientBand[]) => api.put("/settings", { asset_degressive_coefficients: bands }),
    onSuccess: () => invalidate(),
  });
  const submit = () => {
    setErr(null);
    const bands = rows.map((r) => ({ min: Number(r.min), max: r.max.trim() === "" ? null : Number(r.max), coef: Number(r.coef.replace(",", ".")) }));
    const parsed = degressiveCoefficientsSchema.safeParse(bands);
    if (!parsed.success) { setErr(parsed.error.issues[0]?.message ?? "Valeurs invalides"); return; }
    save.mutate(parsed.data);
  };
  const set = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card title="Coefficients de l'amortissement dégressif">
      <p className="text-sm text-muted-foreground">Taux dégressif = coefficient × 100 ÷ durée. Le coefficient est figé sur chaque immobilisation à sa création : modifier ce tableau n'affecte pas les biens existants. Une durée hors tableau (moins de 3 ans) n'est pas accélérée.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label="De (ans)"><Input className="w-24" inputMode="numeric" value={r.min} onChange={(e) => set(i, { min: e.target.value })} /></Field>
            <Field label="À (ans, vide = sans limite)"><Input className="w-40" inputMode="numeric" value={r.max} onChange={(e) => set(i, { max: e.target.value })} /></Field>
            <Field label="Coefficient"><Input className="w-24" inputMode="decimal" value={r.coef} onChange={(e) => set(i, { coef: e.target.value })} /></Field>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} disabled={rows.length <= 1}>Retirer</Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p, { min: "", max: "", coef: "" }])}><Plus />Ajouter une tranche</Button>
        <ActionButton size="sm" pending={save.isPending} onClick={submit}>Enregistrer</ActionButton>
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <ErrorNote error={save.error} />
    </Card>
  );
}

// ── Label layout ─────────────────────────────────────────
const NUM_KEYS = ["widthMm", "heightMm", "cols", "rows", "marginMm"] as const;
type NumKey = (typeof NUM_KEYS)[number];
function LabelFormat() {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs();
  const [f, setF] = useState<AssetLabelFormat | null>(null);
  // Numbers are edited as text, so "63," or "63.5" can be typed; they are parsed when saving.
  const [raw, setRaw] = useState<Record<NumKey, string>>({ widthMm: "", heightMm: "", cols: "", rows: "", marginMm: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!refs.data) return;
    setF(refs.data.labelFormat);
    setRaw(Object.fromEntries(NUM_KEYS.map((k) => [k, String(refs.data!.labelFormat[k]).replace(".", ",")])) as Record<NumKey, string>);
  }, [refs.data]);
  const save = useMutation({ mutationFn: (v: AssetLabelFormat) => api.put("/settings", { asset_label_format: v }), onSuccess: () => invalidate() });
  if (!f) return null;
  const num = (k: NumKey) => (e: React.ChangeEvent<HTMLInputElement>) => setRaw({ ...raw, [k]: e.target.value });
  const submit = () => {
    setErr(null);
    const numbers = Object.fromEntries(NUM_KEYS.map((k) => [k, Number(raw[k].trim().replace(",", "."))]));
    const parsed = assetLabelFormatSchema.safeParse({ ...f, ...numbers, baseUrl: f.baseUrl?.trim() ? f.baseUrl.trim().replace(/\/+$/, "") : null });
    if (!parsed.success) { setErr(parsed.error.issues[0]?.message ?? "Valeurs invalides"); return; }
    save.mutate(parsed.data);
  };
  return (
    <Card title="Étiquettes d'identification">
      <p className="text-sm text-muted-foreground">Mise en page de l'impression : une étiquette par page (imprimante d'étiquettes) ou une planche A4 d'étiquettes. Le QR code ouvre la fiche de l'immobilisation.</p>
      <FormGrid>
        <Field label="Impression"><OptionSelect value={f.mode} onValueChange={(v) => setF({ ...f, mode: v as AssetLabelFormat["mode"] })} options={[{ value: "roll", label: "Une étiquette par page (rouleau)" }, { value: "sheet", label: "Planche A4 (impression en lot)" }]} /></Field>
        <Field label="Largeur d'une étiquette (mm)"><Input inputMode="decimal" value={raw.widthMm} onChange={num("widthMm")} /></Field>
        <Field label="Hauteur d'une étiquette (mm)"><Input inputMode="decimal" value={raw.heightMm} onChange={num("heightMm")} /></Field>
        {f.mode === "sheet" && (
          <>
            <Field label="Colonnes par planche"><Input inputMode="numeric" value={raw.cols} onChange={num("cols")} /></Field>
            <Field label="Lignes par planche"><Input inputMode="numeric" value={raw.rows} onChange={num("rows")} /></Field>
            <Field label="Marge de la planche (mm)"><Input inputMode="decimal" value={raw.marginMm} onChange={num("marginMm")} /></Field>
          </>
        )}
        <div className="col-span-full flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={f.showQr} onCheckedChange={(v) => setF({ ...f, showQr: v === true })} />QR code</label>
          <label className="flex items-center gap-2"><Checkbox checked={f.showBarcode} onCheckedChange={(v) => setF({ ...f, showBarcode: v === true })} />Code-barres</label>
        </div>
        <div className="col-span-full">
          <Field label="Adresse de l'application dans le QR code (laisser vide = adresse de la page qui imprime)">
            <Input placeholder="https://compta.exemple.org" value={f.baseUrl ?? ""} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} />
          </Field>
        </div>
      </FormGrid>
      <ActionButton size="sm" pending={save.isPending} onClick={submit}>Enregistrer</ActionButton>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <ErrorNote error={save.error} />
    </Card>
  );
}

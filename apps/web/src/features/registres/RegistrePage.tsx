import { useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Paperclip, Pencil, Plus, Printer, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader, type Column } from "@/components/common";
import { DateRangePicker, FormDate, dateLimits } from "@/components/form-controls";
import { exportTable, type ExportFormat } from "@/lib/export-table";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { FileUploader, ACCEPT, checkFile } from "./FileUploader";

export interface FieldDef { key: string; label: string; kind?: "text" | "date" | "email" | "tel" | "bool"; required?: boolean; full?: boolean }
export interface Row { id: string; fileCount: number; hasFile: boolean; [k: string]: any }
export interface RegistreConfig {
  type: "dedications" | "baptisms" | "marriages";
  title: string; newLabel: string; newTitle: string; editTitle: string; fileLabel: string; icon: LucideIcon;
  fields: FieldDef[];
  /** Table columns (after the date column, before the file/actions columns). */
  columns: { header: string; key: string; cell?: (r: Row) => ReactNode; text?: (r: Row) => string }[];
  searchHint: string;
  nameOf: (r: Row) => string;
}

const minDate = new Date(1950, 0, 1);
const limits = () => ({ min: minDate, max: dateLimits.past().max });

function buildSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.kind === "bool") shape[f.key] = z.boolean();
    else if (f.kind === "date") shape[f.key] = z.string().min(1, `${f.label} requise`);
    else if (f.kind === "email") shape[f.key] = z.string().trim().email("Email invalide").or(z.literal(""));
    else shape[f.key] = f.required ? z.string().trim().min(1, `${f.label} requis`) : z.string().trim();
  }
  return z.object(shape);
}

export function RegistrePage({ cfg }: { cfg: RegistreConfig }) {
  const api = useApi();
  const s = useSession();
  const qc = useQueryClient();
  const canWrite = s.can("registry.write") && !s.consolidated;
  const [f, setF] = useState({ from: "", to: "", q: "", pastor: "" });
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const key = useScopedKey("registre", cfg.type);
  const list = useQuery({ queryKey: [...key, f], queryFn: () => api.get<Row[]>(`/registres/${cfg.type}`, f) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/registres/${cfg.type}/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const rows = list.data ?? [];
  const dateField = cfg.fields.find((x) => x.kind === "date")!;

  const doExport = (fmt: ExportFormat) => exportTable(fmt, {
    title: `${cfg.title} — ${s.parish?.name ?? "Consolidé"}`,
    subtitle: f.from || f.to ? `Période ${f.from ? fmtDate(f.from) : "…"} – ${f.to ? fmtDate(f.to) : "…"}` : undefined,
    columns: [{ header: "Date", key: "date" }, ...cfg.columns.map((c) => ({ header: c.header, key: c.key })), { header: "Fichier", key: "file" }],
    rows: rows.map((r) => ({ date: fmtDate(r[dateField.key]), ...Object.fromEntries(cfg.columns.map((c) => [c.key, c.text ? c.text(r) : r[c.key] ?? ""])), file: r.hasFile ? "Oui" : "Non" })),
  });

  const columns = useMemo<Column<Row>[]>(() => [
    { header: "Date", sort: (r) => r[dateField.key], cell: (r) => fmtDate(r[dateField.key]) },
    ...cfg.columns.map((c) => ({ header: c.header, sort: (r: Row) => (c.text ? c.text(r) : r[c.key]) as string, cell: c.cell ?? ((r: Row) => r[c.key] ?? "") })),
    { header: "Fichier", cell: (r: Row) => r.hasFile ? <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" />{r.fileCount}</span> : <span className="muted">—</span> },
    { header: "", cell: (r: Row) => (
      <span className="actions">
        <Button size="sm" variant="outline" onClick={() => setEdit(r)}>{canWrite ? <><Pencil />Modifier</> : "Ouvrir"}</Button>
        {canWrite && <Button size="icon-sm" variant="ghost" aria-label="Supprimer" disabled={del.isPending} onClick={() => confirm(`Supprimer « ${cfg.nameOf(r)} » et ses fichiers ? Cette action est définitive.`) && del.mutate(r.id)}><Trash2 /></Button>}
      </span>
    ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cfg, canWrite, del.isPending]);

  return (
    <>
      <PageHeader title={cfg.title} icon={cfg.icon}>
        <span className="actions no-print">
          {s.can("report.export") && <>
            <Button size="sm" variant="outline" onClick={() => doExport("xlsx")}><FileSpreadsheet />Excel</Button>
            <Button size="sm" variant="outline" onClick={() => doExport("pdf")}><FileText />PDF</Button>
            <Button size="sm" variant="outline" onClick={() => doExport("print")}><Printer />Imprimer</Button>
          </>}
          {canWrite && <Button onClick={() => setEdit("new")}><Plus /> {cfg.newLabel}</Button>}
        </span>
      </PageHeader>
      <div className="no-print mb-4 flex flex-wrap items-end gap-x-3 gap-y-3 border-b pb-4">
        <Field label="Période"><DateRangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} min={minDate} max={dateLimits.past().max} /></Field>
        <Field label="Recherche"><Input className="min-w-48" placeholder={cfg.searchHint} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        <Field label="Pasteur"><Input className="min-w-36" value={f.pastor} onChange={(e) => setF({ ...f, pastor: e.target.value })} /></Field>
        {Object.values(f).some(Boolean) && <Button type="button" variant="ghost" size="sm" onClick={() => setF({ from: "", to: "", q: "", pastor: "" })}>Réinitialiser</Button>}
      </div>
      <Card>
        <ErrorNote error={del.error ?? list.error} />
        <DataTable<Row> rows={rows} columns={columns} loading={list.isLoading} pageSize={25} empty="Aucune entrée pour ces filtres" />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? cfg.newTitle : cfg.editTitle}>
        {edit && <RegistreForm cfg={cfg} row={edit === "new" ? null : edit} canWrite={canWrite} onClose={() => setEdit(null)} />}
      </ModalForm>
    </>
  );
}

function RegistreForm({ cfg, row, canWrite, onClose }: { cfg: RegistreConfig; row: Row | null; canWrite: boolean; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const schema = useMemo(() => buildSchema(cfg.fields), [cfg]);
  const defaults = Object.fromEntries(cfg.fields.map((x) => [x.key, x.kind === "bool" ? !!row?.[x.key] : row?.[x.key] ?? (x.kind === "date" && !row ? today() : "")]));
  const { register, control, handleSubmit, formState: { errors } } = useForm<Record<string, any>>({ resolver: zodResolver(schema) as any, defaultValues: defaults });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (v: Record<string, any>) => {
      const saved = row ? await api.patch<Row>(`/registres/${cfg.type}/${row.id}`, v) : await api.post<Row>(`/registres/${cfg.type}`, v);
      if (file) await api.upload(`/registres/${cfg.type}/${saved.id}/files`, file);
      return saved;
    },
    onSettled: () => qc.invalidateQueries(),
    onSuccess: onClose,
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <fieldset disabled={!canWrite} className="contents">
        <FormGrid>
          {cfg.fields.map((x) => x.kind === "bool" ? (
            <label key={x.key} className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register(x.key)} />{x.label}</label>
          ) : (
            <div key={x.key} className={x.full ? "col-span-full" : undefined}>
              <Field label={x.label + (x.required ? " *" : "")} error={errors[x.key]?.message as string | undefined}>
                {x.kind === "date" ? <FormDate control={control} name={x.key} {...limits()} /> : <Input type={x.kind === "email" ? "email" : x.kind === "tel" ? "tel" : "text"} {...register(x.key)} />}
              </Field>
            </div>
          ))}
          {!row && canWrite && (
            <div className="col-span-full">
              <Field label={`${cfg.fileLabel} (optionnel)`} error={fileError ?? undefined}>
                <Input type="file" accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0] ?? null; const err = f ? checkFile(f) : null; setFileError(err); setFile(err ? null : f); if (err) e.target.value = ""; }} />
              </Field>
            </div>
          )}
        </FormGrid>
      </fieldset>
      {row && <div className="mt-3 grid"><FileUploader type={cfg.type} recordId={row.id} label={cfg.fileLabel} canWrite={canWrite} /></div>}
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      {canWrite ? <FormFooter pending={save.isPending} onCancel={onClose} /> : <div className="mt-4 flex justify-end"><Button type="button" variant="ghost" onClick={onClose}>Fermer</Button></div>}
    </form>
  );
}

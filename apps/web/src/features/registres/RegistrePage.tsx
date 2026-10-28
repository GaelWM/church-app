import { useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileSpreadsheet, FileText, Paperclip, Pencil, Plus, Printer, Send, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { REGISTRY_STATUS_LABELS, type TxStatus } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionButton, Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader, ReasonButton, StatusBadge, type Column } from "@/components/common";
import { DateRangePicker, FormDate, FormSelect, OptionSelect, dateLimits } from "@/components/form-controls";
import { exportTable, type ExportFormat } from "@/lib/export-table";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { ValidationFlowButton, countByStatus } from "../validation/ValidationFlow";
import { FileUploader, ACCEPT, checkFile } from "./FileUploader";

export interface FieldDef { key: string; label: string; kind?: "text" | "date" | "email" | "tel" | "bool" | "pastor"; required?: boolean; full?: boolean }
export interface Row {
  id: string; fileCount: number; hasFile: boolean; createdBy: string; createdByName: string | null;
  // circuit Pasteur assistant → Pasteur titulaire (workflow registers only)
  status?: TxStatus; n1Skipped?: boolean; n2Skipped?: boolean; rejectionReason?: string | null;
  validator1Name?: string | null; validator2Name?: string | null;
  [k: string]: any;
}
export interface RegistreConfig {
  type: "dedications" | "baptisms" | "marriages";
  title: string; newLabel: string; newTitle: string; editTitle: string; fileLabel: string; icon: LucideIcon;
  fields: FieldDef[];
  /** Table columns (after the date column, before the file/actions columns). */
  columns: { header: string; key: string; cell?: (r: Row) => ReactNode; text?: (r: Row) => string }[];
  searchHint: string;
  nameOf: (r: Row) => string;
  /** Entries go through the Pasteur assistant → Pasteur titulaire circuit (baptêmes, mariages). */
  workflow?: boolean;
}

/** Status filter: "a_valider" means "what the signed-in user can validate now". */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Tous" }, { value: "a_valider", label: "À valider" },
  ...(["brouillon", "soumise", "validee1", "validee", "rejetee"] as const).map((v) => ({ value: v, label: REGISTRY_STATUS_LABELS[v] })),
];
const isEditable = (r: Row) => r.status === "brouillon" || r.status === "rejetee";

/** Who signed each level, or why a level was skipped (creator-skip, see registrySubmitState). */
function signatures(r: Row): string {
  const parts = [`Saisi par ${r.createdByName ?? "—"}`];
  if (r.n1Skipped) parts.push("1re validation sautée (auteur Pasteur assistant)");
  else if (r.validator1Name) parts.push(`Validé 1 par ${r.validator1Name}`);
  if (r.n2Skipped && r.status === "validee") parts.push("validation finale par le Pasteur assistant (auteur Pasteur titulaire)");
  else if (r.validator2Name) parts.push(`Validé par ${r.validator2Name}`);
  return parts.join(" · ");
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

/** Active Pasteur users of the current parish. A value already stored on a record stays selectable even if that user is gone. */
function usePastorOptions(current?: string) {
  const api = useApi();
  const q = useQuery({ queryKey: useScopedKey("registre-pastors"), queryFn: () => api.get<{ id: string; fullName: string }[]>("/registres/pastors"), staleTime: 60_000 });
  const names = (q.data ?? []).map((p) => p.fullName);
  if (current && !names.includes(current)) names.push(current);
  return [{ value: "", label: "—" }, ...names.map((n) => ({ value: n, label: n }))];
}

export function RegistrePage({ cfg }: { cfg: RegistreConfig }) {
  const api = useApi();
  const s = useSession();
  const qc = useQueryClient();
  const canWrite = s.can("registry.write") && !s.consolidated;
  const can1 = cfg.workflow && s.can("registry.validate1") && !s.consolidated;
  const can2 = cfg.workflow && s.can("registry.validate2") && !s.consolidated;
  const me = s.me.user.id;
  const [f, setF] = useState({ from: "", to: "", q: "", pastor: "", status: "" });
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const key = useScopedKey("registre", cfg.type);
  const status = f.status === "a_valider" ? [can1 && "soumise", can2 && "validee1"].filter(Boolean).join(",") || "none" : f.status;
  const list = useQuery({ queryKey: [...key, f], queryFn: () => api.get<Row[]>(`/registres/${cfg.type}`, { ...f, status: cfg.workflow ? status : "" }) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/registres/${cfg.type}/${id}`), onSuccess: () => qc.invalidateQueries() });
  const act = useMutation({
    mutationFn: (v: { id: string; action: string; comment?: string }) => api.post(`/registres/${cfg.type}/${v.id}/${v.action}`, { comment: v.comment }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const rows = list.data ?? [];
  const dateField = cfg.fields.find((x) => x.kind === "date")!;
  const pastorOptions = usePastorOptions(f.pastor);

  const doExport = (fmt: ExportFormat) => exportTable(fmt, {
    title: `${cfg.title} — ${s.parish?.name ?? "Consolidé"}`,
    subtitle: f.from || f.to ? `Période ${f.from ? fmtDate(f.from) : "…"} – ${f.to ? fmtDate(f.to) : "…"}` : undefined,
    columns: [{ header: "Date", key: "date" }, ...cfg.columns.map((c) => ({ header: c.header, key: c.key })), { header: "Fichier", key: "file" },
      ...(cfg.workflow ? [{ header: "Statut", key: "status" }] : [])],
    rows: rows.map((r) => ({ date: fmtDate(r[dateField.key]), ...Object.fromEntries(cfg.columns.map((c) => [c.key, c.text ? c.text(r) : r[c.key] ?? ""])), file: r.hasFile ? "Oui" : "Non",
      status: r.status ? REGISTRY_STATUS_LABELS[r.status] : "" })),
  });

  const pending = (r: Row, action: string) => act.isPending && act.variables?.id === r.id && act.variables?.action === action;
  /** Row actions of a workflow register: the author edits and submits a draft, the two pastors sign in turn. */
  const workflowActions = (r: Row) => {
    const mine = r.createdBy === me;
    const ownDraft = canWrite && mine && isEditable(r);
    return (
      <span className="actions">
        <Button size="sm" variant="outline" onClick={() => setEdit(r)}>{ownDraft ? <><Pencil />Modifier</> : "Ouvrir"}</Button>
        {ownDraft && <ActionButton size="sm" icon={Send} pending={pending(r, "submit")} onClick={() => act.mutate({ id: r.id, action: "submit" })}>Soumettre</ActionButton>}
        {!mine && r.status === "soumise" && can1 && <>
          <ActionButton size="sm" icon={Check} pending={pending(r, "validate1")} onClick={() => act.mutate({ id: r.id, action: "validate1" })}>Valider</ActionButton>
          <ReasonButton danger icon={X} label="Rejeter" onConfirm={(comment) => act.mutate({ id: r.id, action: "reject", comment })} />
        </>}
        {!mine && r.status === "validee1" && can2 && <>
          <ActionButton size="sm" icon={Check} pending={pending(r, "validate2")} onClick={() => act.mutate({ id: r.id, action: "validate2" })}>Valider</ActionButton>
          <ReasonButton danger icon={X} label="Rejeter" onConfirm={(comment) => act.mutate({ id: r.id, action: "reject", comment })} />
        </>}
        {r.status === "validee" && can2 && <ReasonButton icon={Undo2} label="Renvoyer en correction" onConfirm={(comment) => act.mutate({ id: r.id, action: "reopen", comment })} />}
        {ownDraft && <Button size="icon-sm" variant="ghost" aria-label="Supprimer" disabled={del.isPending} onClick={() => confirm(`Supprimer « ${cfg.nameOf(r)} » et ses fichiers ? Cette action est définitive.`) && del.mutate(r.id)}><Trash2 /></Button>}
      </span>
    );
  };

  const columns = useMemo<Column<Row>[]>(() => [
    { header: "Date", sort: (r) => r[dateField.key], cell: (r) => fmtDate(r[dateField.key]) },
    ...cfg.columns.map((c) => ({ header: c.header, sort: (r: Row) => (c.text ? c.text(r) : r[c.key]) as string, cell: c.cell ?? ((r: Row) => r[c.key] ?? "") })),
    { header: "Fichier", cell: (r: Row) => r.hasFile ? <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" />{r.fileCount}</span> : <span className="muted">—</span> },
    ...(cfg.workflow ? [{ header: "Statut", sort: (r: Row) => r.status ?? "", cell: (r: Row) => (
      <span title={r.status === "rejetee" && r.rejectionReason ? `Motif : ${r.rejectionReason}` : signatures(r)}><StatusBadge status={r.status!} labels={REGISTRY_STATUS_LABELS} /></span>
    ) }] : []),
    cfg.workflow ? { header: "", cell: workflowActions } : { header: "", cell: (r: Row) => (
      <span className="actions">
        <Button size="sm" variant="outline" onClick={() => setEdit(r)}>{canWrite ? <><Pencil />Modifier</> : "Ouvrir"}</Button>
        {canWrite && <Button size="icon-sm" variant="ghost" aria-label="Supprimer" disabled={del.isPending} onClick={() => confirm(`Supprimer « ${cfg.nameOf(r)} » et ses fichiers ? Cette action est définitive.`) && del.mutate(r.id)}><Trash2 /></Button>}
      </span>
    ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cfg, canWrite, can1, can2, me, del.isPending, act.isPending, act.variables]);

  return (
    <>
      <PageHeader title={cfg.title} icon={cfg.icon}>
        <span className="actions no-print">
          {s.can("report.export") && <>
            <Button size="sm" variant="outline" onClick={() => doExport("xlsx")}><FileSpreadsheet />Excel</Button>
            <Button size="sm" variant="outline" onClick={() => doExport("pdf")}><FileText />PDF</Button>
            <Button size="sm" variant="outline" onClick={() => doExport("print")}><Printer />Imprimer</Button>
          </>}
          {cfg.workflow && <ValidationFlowButton circuit="registres" counts={countByStatus(rows.filter((r): r is Row & { status: TxStatus } => !!r.status))} />}
          {canWrite && <Button onClick={() => setEdit("new")}><Plus /> {cfg.newLabel}</Button>}
        </span>
      </PageHeader>
      <div className="no-print mb-4 flex flex-wrap items-end gap-x-3 gap-y-3 border-b pb-4">
        <Field label="Période"><DateRangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} min={minDate} max={dateLimits.past().max} /></Field>
        <Field label="Recherche"><Input className="min-w-48" placeholder={cfg.searchHint} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        <Field label="Pasteur"><OptionSelect className="min-w-40" aria-label="Pasteur" value={f.pastor} onValueChange={(v) => setF({ ...f, pastor: v })} options={[{ value: "", label: "Tous" }, ...pastorOptions.slice(1)]} /></Field>
        {cfg.workflow && <Field label="Statut"><OptionSelect className="min-w-44" aria-label="Statut" value={f.status} onValueChange={(v) => setF({ ...f, status: v })}
          options={STATUS_FILTERS.filter((o) => o.value !== "a_valider" || can1 || can2)} /></Field>}
        {Object.values(f).some(Boolean) && <Button type="button" variant="ghost" size="sm" onClick={() => setF({ from: "", to: "", q: "", pastor: "", status: "" })}>Réinitialiser</Button>}
      </div>
      <Card>
        <ErrorNote error={act.error ?? del.error ?? list.error} />
        <DataTable<Row> rows={rows} columns={columns} loading={list.isLoading} pageSize={25} empty="Aucune entrée pour ces filtres" />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? cfg.newTitle : cfg.editTitle}>
        {edit && <RegistreForm cfg={cfg} row={edit === "new" ? null : edit} canWrite={canWrite} me={me} onClose={() => setEdit(null)} />}
      </ModalForm>
    </>
  );
}

function RegistreForm({ cfg, row, canWrite, me, onClose }: { cfg: RegistreConfig; row: Row | null; canWrite: boolean; me: string; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const schema = useMemo(() => buildSchema(cfg.fields), [cfg]);
  const defaults = Object.fromEntries(cfg.fields.map((x) => [x.key, x.kind === "bool" ? !!row?.[x.key] : row?.[x.key] ?? (x.kind === "date" && !row ? today() : "")]));
  const { register, control, handleSubmit, formState: { errors } } = useForm<Record<string, any>>({ resolver: zodResolver(schema) as any, defaultValues: defaults });
  const pastorOptions = usePastorOptions(row?.pastorName);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Workflow registers: only the author edits, and only a draft or a rejected entry (frozen once submitted).
  const canEdit = canWrite && (!cfg.workflow || !row || (row.createdBy === me && isEditable(row)));
  const save = useMutation({
    mutationFn: async ({ v, submit }: { v: Record<string, any>; submit: boolean }) => {
      const saved = row ? await api.patch<Row>(`/registres/${cfg.type}/${row.id}`, v) : await api.post<Row>(`/registres/${cfg.type}`, v);
      if (file) await api.upload(`/registres/${cfg.type}/${saved.id}/files`, file);
      if (submit) await api.post(`/registres/${cfg.type}/${saved.id}/submit`, {});
      return saved;
    },
    // Wait for the list to refetch so the new/edited row is already in the table when the dialog closes.
    onSuccess: async () => { await qc.invalidateQueries(); onClose(); },
    onError: () => { qc.invalidateQueries(); }, // e.g. the record saved but the file upload failed: keep the list truthful
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate({ v, submit: false }))} noValidate>
      {cfg.workflow && row?.status && (
        <div className="mb-3 space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={row.status} labels={REGISTRY_STATUS_LABELS} /><span className="text-muted-foreground">{signatures(row)}</span></div>
          {row.status === "rejetee" && row.rejectionReason && <p className="text-destructive">Motif : {row.rejectionReason}</p>}
        </div>
      )}
      <fieldset disabled={!canEdit} className="contents">
        <FormGrid>
          {cfg.fields.map((x) => x.kind === "bool" ? (
            <label key={x.key} className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register(x.key)} />{x.label}</label>
          ) : (
            <div key={x.key} className={x.full ? "col-span-full" : undefined}>
              <Field label={x.label + (x.required ? " *" : "")} error={errors[x.key]?.message as string | undefined}>
                {x.kind === "date" ? <FormDate control={control} name={x.key} {...limits()} /> : x.kind === "pastor" ? <FormSelect control={control} name={x.key} options={pastorOptions} /> : <Input type={x.kind === "email" ? "email" : x.kind === "tel" ? "tel" : "text"} {...register(x.key)} />}
              </Field>
            </div>
          ))}
          {!row && canEdit && (
            <div className="col-span-full">
              <Field label={`${cfg.fileLabel} (optionnel)`} error={fileError ?? undefined}>
                <Input type="file" accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0] ?? null; const err = f ? checkFile(f) : null; setFileError(err); setFile(err ? null : f); if (err) e.target.value = ""; }} />
              </Field>
            </div>
          )}
        </FormGrid>
      </fieldset>
      {row && <div className="mt-3 grid"><FileUploader type={cfg.type} recordId={row.id} label={cfg.fileLabel} canWrite={canWrite} canDelete={canEdit} /></div>}
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      {canEdit ? (
        <FormFooter pending={save.isPending} onCancel={onClose}
          extra={cfg.workflow && <Button type="button" variant="outline" disabled={save.isPending} onClick={handleSubmit((v) => save.mutate({ v, submit: true }))}><Send />Enregistrer et soumettre</Button>} />
      ) : <div className="mt-4 flex justify-end"><Button type="button" variant="ghost" onClick={onClose}>Fermer</Button></div>}
    </form>
  );
}

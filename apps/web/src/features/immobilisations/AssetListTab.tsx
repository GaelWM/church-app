import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Boxes, Pencil, Plus, Search, Trash2, TrendingDown } from "lucide-react";
import { ASSET_TYPES, ASSET_TYPE_LABELS, DEPRECIATION_METHOD_LABELS, type AssetType, type Currency, type DepreciationMethod } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, ExportButtons, Field, ModalForm, type Column } from "@/components/common";
import { OptionSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { AssetForm } from "./AssetForm";

export interface Asset {
  id: string; parishId: string; code: string; registeredAt: string; type: AssetType; name: string;
  acquisitionDate: string; currency: Currency; amountMinor: string; invoiceNumber: string | null;
  usefulLifeYears: number | null; depreciationMethod: DepreciationMethod; condition: string | null; location: string | null;
  transactionId: string | null; createdBy: string; createdAt: string; updatedAt: string;
  /** Current calendar year's depreciation, computed server-side; null for terrain / no duration. */
  accumulatedMinor: string | null; netBookValueMinor: string | null;
}

/** Shared list query: also feeds the depreciation picker and the report tab's flat export (no extra round-trip). */
export function useAssets() {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("immobilisations"), queryFn: () => api.get<Asset[]>("/immobilisations") });
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const typeOptions = ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }));

export function AssetListTab() {
  const s = useSession();
  const api = useApi();
  const qc = useQueryClient();
  const invalidate = useInvalidateLedger();
  const [, setParams] = useSearchParams();
  const canWrite = s.can("asset.manage") && !s.consolidated;
  const [f, setF] = useState({ q: "", type: "" });
  const [edit, setEdit] = useState<Asset | "new" | null>(null);
  const list = useAssets();
  const del = useMutation({ mutationFn: (id: string) => api.del(`/immobilisations/${id}`), onSuccess: invalidate });
  const rows = useMemo(() => (list.data ?? []).filter((a) =>
    (!f.type || a.type === f.type) && (!f.q || norm(`${a.code} ${a.name} ${a.invoiceNumber ?? ""} ${a.location ?? ""}`).includes(norm(f.q)))
  ), [list.data, f]);

  const vnc = (a: Asset) => (a.netBookValueMinor == null ? "—" : money(a.netBookValueMinor, a.currency));
  const spec = () => ({
    title: `Immobilisations — ${s.parish?.name ?? "Consolidé"}`,
    columns: [
      { header: "Code", key: "code" }, { header: "Enregistré le", key: "registeredAt" }, { header: "Type", key: "type" }, { header: "Nom", key: "name" },
      { header: "Date d'acquisition", key: "acquisitionDate" }, { header: "Montant", key: "amount", align: "right" as const }, { header: "N° Facture", key: "invoice" },
      { header: "Durée", key: "duration" }, { header: "Mode", key: "mode" }, { header: "État", key: "condition" }, { header: "Localisation", key: "location" },
      { header: "VNC", key: "vnc", align: "right" as const },
    ],
    rows: rows.map((a) => ({
      code: a.code, registeredAt: fmtDate(a.registeredAt), type: ASSET_TYPE_LABELS[a.type], name: a.name, acquisitionDate: fmtDate(a.acquisitionDate),
      amount: money(a.amountMinor, a.currency), invoice: a.invoiceNumber ?? "", duration: a.usefulLifeYears ?? "", mode: DEPRECIATION_METHOD_LABELS[a.depreciationMethod],
      condition: a.condition ?? "", location: a.location ?? "", vnc: a.netBookValueMinor != null ? money(a.netBookValueMinor, a.currency) : "",
    })),
  });

  const columns = useMemo<Column<Asset>[]>(() => [
    { header: "Code", cell: (a) => a.code, sort: (a) => a.code },
    { header: "Enregistré le", cell: (a) => fmtDate(a.registeredAt), sort: (a) => a.registeredAt },
    { header: "Type", cell: (a) => ASSET_TYPE_LABELS[a.type], sort: (a) => a.type },
    { header: "Nom", cell: (a) => a.name, sort: (a) => a.name },
    { header: "Date d'acquisition", cell: (a) => fmtDate(a.acquisitionDate), sort: (a) => a.acquisitionDate },
    { header: "Montant", align: "right", cell: (a) => money(a.amountMinor, a.currency), sort: (a) => a.amountMinor },
    { header: "N° Facture", cell: (a) => a.invoiceNumber ?? "—" },
    { header: "Durée", cell: (a) => (a.usefulLifeYears ? `${a.usefulLifeYears} ans` : "—") },
    { header: "Mode", cell: (a) => DEPRECIATION_METHOD_LABELS[a.depreciationMethod] },
    { header: "État", cell: (a) => a.condition ?? "—" },
    { header: "Localisation", cell: (a) => a.location ?? "—" },
    { header: "VNC", align: "right", cell: (a) => vnc(a) },
    { header: "", cell: (a) => (
      <span className="actions">
        <Button size="sm" variant="outline" onClick={() => setParams({ tab: "amortissement", id: a.id })}><TrendingDown />Amortissement</Button>
        {canWrite && <Button size="sm" variant="outline" onClick={() => setEdit(a)}><Pencil />Modifier</Button>}
        {canWrite && <Button size="icon-sm" variant="ghost" aria-label={`Supprimer ${a.name}`} disabled={del.isPending} onClick={() => confirm(`Supprimer « ${a.name} » (${a.code}) ? Cette action est définitive.`) && del.mutate(a.id)}><Trash2 /></Button>}
      </span>
    ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite, del.isPending]);

  return (
    <>
      <Card title="Immobilisations" actions={<span className="flex flex-wrap items-center gap-2">
        <ExportButtons spec={spec} />
        {canWrite && <Button size="sm" onClick={() => setEdit("new")}><Plus /> Immobilisation</Button>}
      </span>}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="relative max-w-sm"><Search className="absolute left-2 top-2 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Code, nom, facture, localisation…" aria-label="Rechercher" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <Field label="Type"><OptionSelect size="sm" className="w-auto min-w-40" aria-label="Type" value={f.type} onValueChange={(v) => setF({ ...f, type: v })} options={[{ value: "", label: "Tous types" }, ...typeOptions]} /></Field>
        </div>
        <ErrorNote error={del.error ?? list.error} />
        <DataTable<Asset> rows={rows} columns={columns} loading={list.isLoading} emptyIcon={Boxes} empty="Aucune immobilisation enregistrée" pageSize={25} />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? "Nouvelle immobilisation" : "Modifier l'immobilisation"}>
        {edit && <AssetForm asset={edit === "new" ? null : edit} onClose={() => { setEdit(null); qc.invalidateQueries(); }} />}
      </ModalForm>
    </>
  );
}

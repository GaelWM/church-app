import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { STATUS_LABELS, type TxStatus } from "@church/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DateRangePicker, OptionSelect } from "@/components/form-controls";
import { DataTable, ErrorNote, Field, PageHeader } from "@/components/common";
import { exportTable, type ExportFormat } from "@/lib/export-table";
import { useApi } from "../../core/api";
import { fmtDate } from "../../core/format";
import { useAccounts, useCategories, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { REPORTS, SERVICE_TYPES, buildTable, type ReportDef, type Row } from "./definitions";

type Filters = Record<string, string>;
const ALL = { value: "", label: "Tous" };
const opts = (items: { value: string; label: string }[]) => [ALL, ...items];

const paramOf = (key: string, f: Filters): Record<string, string> => {
  const map: Record<string, string> = { engType: "type", workerCategory: "category" };
  return { [map[key] ?? key]: f[key] ?? "" };
};

/** Rapports et éditions (§18): server aggregates, one table, Excel / PDF / print. */
export function ReportsPage() {
  const api = useApi();
  const s = useSession();
  const accounts = useAccounts();
  const [key, setKey] = useState(REPORTS[0]!.key);
  const def = REPORTS.find((r) => r.key === key)!;
  const categories = useCategories(def.categoryKind);
  const [f, setF] = useState<Filters>({});
  const setFilter = (patch: Filters) => setF((p) => ({ ...p, ...patch }));
  const pick = (d: ReportDef) => { setKey(d.key); setF({ ...d.defaults }); };
  const users = useQuery({ queryKey: useScopedKey("report-users"), queryFn: () => api.get<{ id: string; fullName: string }[]>("/reports/users"), enabled: def.filters.includes("enteredBy") || def.filters.includes("validator") });

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    for (const fk of def.filters) {
      if (fk === "period") { p.from = f.from ?? ""; p.to = f.to ?? ""; } else Object.assign(p, paramOf(fk, f));
    }
    return p;
  }, [def, f]);
  const q = useQuery({
    queryKey: useScopedKey("report", key, params),
    queryFn: () => api.get<{ rows: Row[]; totals: unknown; meta: Record<string, unknown> }>(`/reports/${key}`, params),
  });
  const { data, tot } = useMemo(() => buildTable(def, q.data?.rows ?? [], q.data?.totals), [def, q.data]);

  const subtitle = () => {
    const name = (list: { id: string; name?: string; fullName?: string }[] | undefined, id?: string) => list?.find((x) => x.id === id)?.name ?? list?.find((x) => x.id === id)?.fullName;
    const parts = [s.parish?.name ?? "Consolidé",
      f.from || f.to ? `Période ${f.from ? fmtDate(f.from) : "…"} – ${f.to ? fmtDate(f.to) : "…"}` : "",
      f.currency && `Devise ${f.currency}`, f.accountId && `Compte ${name(accounts.data, f.accountId) ?? ""}`, f.categoryId && `Catégorie ${name(categories.data, f.categoryId) ?? ""}`,
      f.status && `Statut ${f.status.split(",").map((x) => STATUS_LABELS[x as TxStatus] ?? x).join(", ")}`,
      f.enteredBy && `Initiateur ${name(users.data, f.enteredBy) ?? ""}`, f.validator && `Validateur ${name(users.data, f.validator) ?? ""}`,
      f.serviceType && `Culte ${f.serviceType}`, f.q && `Recherche « ${f.q} »`].filter(Boolean);
    return parts.join(" · ");
  };
  const doExport = (fmt: ExportFormat) => exportTable(fmt, {
    title: def.title, subtitle: subtitle(),
    columns: def.columns.map((c) => ({ header: c.header, key: c.key, align: c.align })),
    rows: [...data, ...tot],
  });
  const canExport = s.can("report.export");

  return (
    <>
      <PageHeader title="Rapports et éditions">
        {canExport && (
          <span className="actions no-print flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!data.length} onClick={() => doExport("xlsx")}><FileSpreadsheet />Excel</Button>
            <Button size="sm" variant="outline" disabled={!data.length} onClick={() => doExport("pdf")}><FileText />PDF</Button>
            <Button size="sm" variant="outline" disabled={!data.length} onClick={() => doExport("print")}><Printer />Imprimer</Button>
          </span>
        )}
      </PageHeader>

      <div className="no-print mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="tablist" aria-label="Choix du rapport">
        {REPORTS.map((r) => (
          <button key={r.key} role="tab" aria-selected={r.key === key} type="button" onClick={() => pick(r)} title={r.description}
            className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted", r.key === key && "border-primary bg-primary/5 font-medium text-primary")}>
            {r.title}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{def.description}</p>

      <div className="no-print mb-5 flex flex-wrap items-end gap-x-3 gap-y-3 border-b pb-5">
        {def.filters.includes("period") && <Field label="Période"><DateRangePicker from={f.from ?? ""} to={f.to ?? ""} onChange={(r) => setFilter(r)} /></Field>}
        {def.filters.includes("accountId") && <Field label="Compte"><OptionSelect className="min-w-36" value={f.accountId ?? ""} onValueChange={(v) => setFilter({ accountId: v })} placeholder="Tous" options={opts((accounts.data ?? []).map((a) => ({ value: a.id, label: a.name })))} /></Field>}
        {def.filters.includes("categoryId") && <Field label="Catégorie"><OptionSelect className="min-w-40" value={f.categoryId ?? ""} onValueChange={(v) => setFilter({ categoryId: v })} placeholder="Toutes" options={[{ value: "", label: "Toutes" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></Field>}
        {def.filters.includes("currency") && <Field label="Devise"><OptionSelect className="min-w-28" value={f.currency ?? ""} onValueChange={(v) => setFilter({ currency: v })} placeholder="Toutes" options={[{ value: "", label: "Toutes" }, { value: "CDF", label: "CDF" }, { value: "USD", label: "USD" }]} /></Field>}
        {def.filters.includes("status") && (
          <Field label="Statut"><OptionSelect className="min-w-36" value={f.status ?? ""} onValueChange={(v) => setFilter({ status: v })} placeholder="Tous"
            options={[...(def.defaults?.status ? [] : [ALL]), ...(["brouillon", "soumise", "validee1", "validee", "rejetee", "annulee"] as TxStatus[]).map((x) => ({ value: x, label: STATUS_LABELS[x] }))]} /></Field>
        )}
        {def.filters.includes("enteredBy") && <Field label="Initiateur"><OptionSelect className="min-w-36" value={f.enteredBy ?? ""} onValueChange={(v) => setFilter({ enteredBy: v })} placeholder="Tous" options={opts((users.data ?? []).map((u) => ({ value: u.id, label: u.fullName })))} /></Field>}
        {def.filters.includes("validator") && <Field label="Validateur"><OptionSelect className="min-w-36" value={f.validator ?? ""} onValueChange={(v) => setFilter({ validator: v })} placeholder="Tous" options={opts((users.data ?? []).map((u) => ({ value: u.id, label: u.fullName })))} /></Field>}
        {def.filters.includes("engType") && <Field label="Type"><OptionSelect className="min-w-36" value={f.engType ?? ""} onValueChange={(v) => setFilter({ engType: v })} placeholder="Tous" options={opts([["construction", "Construction"], ["partenariat", "Partenariat"], ["parcelle", "Achat parcelle"], ["autre", "Autres"]].map(([value, label]) => ({ value: value!, label: label! })))} /></Field>}
        {def.filters.includes("serviceType") && <Field label="Culte"><OptionSelect className="min-w-40" value={f.serviceType ?? ""} onValueChange={(v) => setFilter({ serviceType: v })} placeholder="Tous" options={opts(SERVICE_TYPES.map((x) => ({ value: x, label: x })))} /></Field>}
        {def.filters.includes("workerCategory") && <Field label="Catégorie"><OptionSelect className="min-w-40" value={f.workerCategory ?? ""} onValueChange={(v) => setFilter({ workerCategory: v })} placeholder="Toutes" options={[{ value: "", label: "Toutes" }, { value: "pasteur", label: "Pasteur" }, { value: "chef_departement", label: "Chef de département" }, { value: "ouvrier", label: "Ouvrier" }]} /></Field>}
        {def.filters.includes("q") && <Field label="Nom"><input className="h-9 min-w-40 rounded-md border bg-background px-3 text-sm" value={f.q ?? ""} onChange={(e) => setFilter({ q: e.target.value })} placeholder="Rechercher" /></Field>}
        {Object.entries(f).some(([k, v]) => v && v !== def.defaults?.[k]) && <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...def.defaults })}>Réinitialiser</Button>}
      </div>

      {q.isError && <ErrorNote error={q.error} />}
      <h2 className="mb-2 hidden text-lg font-semibold print:block">{def.title} — {subtitle()}</h2>
      <DataTable
        rows={data.map((r, i) => ({ id: String(i), ...r }))} loading={q.isLoading} pageSize={50} empty="Aucune donnée pour ces filtres"
        columns={def.columns.map((c) => ({ header: c.header, align: c.align, sort: (r: Row) => r[c.key], cell: (r: Row) => r[c.key] }))}
      />
      {tot.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
          {tot.map((t, i) => (
            <div key={i} className="flex flex-wrap gap-x-4 gap-y-1">
              <b>{t[def.totalLabelCol]}</b>
              {def.columns.filter((c) => def.totalMap?.[c.key] && c.key !== def.totalLabelCol).map((c) => <span key={c.key}><span className="text-muted-foreground">{c.header} :</span> <span className="tabular-nums">{String(t[c.key] ?? "")}</span></span>)}
              {def.totalNote && <span className="text-muted-foreground">{t[def.totalNote.col]}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

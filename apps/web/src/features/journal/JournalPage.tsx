import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useAccounts, useCategories, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { FileSpreadsheet, FileText } from "lucide-react";
import { STATUS_LABELS, type TxStatus } from "@church/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker, OptionSelect, dateLimits } from "../../components/form-controls";
import { DataTable, Field, Money, StatusBadge, PageHeader } from "../../components/common";
import { exportExcel, exportPdf } from "./export";
import { Button } from "@/components/ui/button";

type Row = Tx & { running_balance: string; category_id?: string; account_id?: string; amount_minor?: string; entered_by?: string };

/** Read-only chronological list of every line (the same table as the menus, unfiltered). */
export function JournalPage() {
  const api = useApi();
  const s = useSession();
  const accounts = useAccounts();
  const categories = useCategories();
  const [f, setF] = useState({ from: "", to: "", accountId: "", categoryId: "", currency: "", status: "" });
  const rows = useQuery({ queryKey: useScopedKey("journal", f), queryFn: () => api.get<Row[]>("/transactions/journal", f) });
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["tx", open], queryFn: () => api.get<any>(`/transactions/${open}`), enabled: !!open });
  // Raw SQL rows use snake_case.
  const norm = (r: Row) => ({ ...r, accountId: r.accountId ?? r.account_id!, categoryId: r.categoryId ?? r.category_id ?? null, amountMinor: r.amountMinor ?? r.amount_minor! });
  const data = (rows.data ?? []).map(norm);
  const acct = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "";
  const cat = (id?: string | null) => categories.data?.find((c) => c.id === id)?.name ?? "";
  const table = () => data.map((r) => [fmtDate(r.date), r.reference, acct(r.accountId), cat(r.categoryId), r.description ?? "", (r.direction === "in" ? "" : "-") + (Number(r.amountMinor) / 100).toFixed(2), r.currency, (Number(r.running_balance) / 100).toFixed(2), r.status]);
  const head = ["Date", "Référence", "Compte", "Catégorie", "Description", "Montant", "Devise", "Solde (validé)", "Statut"];

  return (
    <>
      <PageHeader title="Journal des transactions">
        {s.can("report.export") && (
          <span className="actions no-print">
            <Button size="sm" variant="outline" onClick={() => exportExcel("journal", head, table())}><FileSpreadsheet />Excel</Button>
            <Button size="sm" variant="outline" onClick={() => exportPdf(`Journal — ${s.parish?.name ?? "Consolidé"}`, head, table())}><FileText />PDF</Button>
          </span>
        )}
      </PageHeader>
      <div className="no-print mb-5 flex flex-wrap items-end gap-x-3 gap-y-3 border-b pb-5 ">
        <Field label="Période"><DateRangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} max={dateLimits.past().max} /></Field>
        <Field label="Compte"><OptionSelect className="min-w-36" value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })} placeholder="Tous" options={[{ value: "", label: "Tous" }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))]} /></Field>
        <Field label="Catégorie"><OptionSelect className="min-w-40" value={f.categoryId} onValueChange={(v) => setF({ ...f, categoryId: v })} placeholder="Toutes" options={[{ value: "", label: "Toutes" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Devise"><OptionSelect className="min-w-28" value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })} placeholder="Toutes" options={[{ value: "", label: "Toutes" }, { value: "CDF", label: "CDF" }, { value: "USD", label: "USD" }]} /></Field>
        <Field label="Statut"><OptionSelect className="min-w-32" value={f.status} onValueChange={(v) => setF({ ...f, status: v })} placeholder="Tous" options={[{ value: "", label: "Tous" }, ...(["brouillon", "soumise", "validee1", "validee", "rejetee"] as TxStatus[]).map((x) => ({ value: x, label: STATUS_LABELS[x] }))]} /></Field>
        {Object.values(f).some(Boolean) && <Button type="button" variant="ghost" size="sm" onClick={() => setF({ from: "", to: "", accountId: "", categoryId: "", currency: "", status: "" })}>Réinitialiser</Button>}
      </div>
      <div>
        <DataTable
          rows={data} loading={rows.isLoading} pageSize={25} empty="Aucune écriture pour ces filtres"
          columns={[
            { header: "Date", sort: (r) => r.date, cell: (r) => fmtDate(r.date) },
            { header: "Réf.", sort: (r) => r.reference, cell: (r) => <a href="#" className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => { e.preventDefault(); setOpen(open === r.id ? null : r.id); }}>{r.reference}</a> },
            { header: "Compte", sort: (r) => acct(r.accountId), cell: (r) => acct(r.accountId) },
            { header: "Catégorie", sort: (r) => cat(r.categoryId), cell: (r) => cat(r.categoryId) },
            { header: "Entrée", align: "right", cell: (r) => (r.direction === "in" ? <Money value={r.amountMinor} currency={r.currency as Currency} /> : "") },
            { header: "Sortie", align: "right", cell: (r) => (r.direction === "out" ? <Money value={r.amountMinor} currency={r.currency as Currency} /> : "") },
            { header: "Solde", align: "right", cell: (r) => <Money value={r.running_balance} currency={r.currency as Currency} /> },
            { header: "Statut", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {open && (
          <div className="mt-3 rounded-lg border p-3">
            <h3 className="mb-2 font-medium">Historique de validation{detail.data ? ` — ${detail.data.reference}` : ""}</h3>
            {detail.isLoading ? (
              <div role="status" aria-label="Chargement" className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-3/5" /></div>
            ) : (
              <ol className="space-y-2">
                {detail.data?.events.map((e: any) => {
                  return (
                    <li key={e.id} className="flex items-start gap-2 text-sm">
                      <div>
                        <b>{STATUS_LABELS[e.toStatus as TxStatus] ?? e.toStatus}</b> — {e.actorName}
                        <span className="text-muted-foreground"> · {new Date(e.at).toLocaleString("fr-FR")}</span>
                        {e.comment && <div className="text-muted-foreground">« {e.comment} »</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </div>
    </>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useAccounts, useCategories, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { BookOpen, FileSpreadsheet, FileText, History, ListFilter } from "lucide-react";
import { STATUS_LABELS, type TxStatus } from "@church/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, DataTable, Field, StatusBadge, PageHeader, STATUS_ICON } from "../../components/common";
import { exportExcel, exportPdf } from "./export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

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
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  // Raw SQL rows use snake_case.
  const norm = (r: Row) => ({ ...r, accountId: r.accountId ?? r.account_id!, categoryId: r.categoryId ?? r.category_id ?? null, amountMinor: r.amountMinor ?? r.amount_minor! });
  const data = (rows.data ?? []).map(norm);
  const acct = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "";
  const cat = (id?: string | null) => categories.data?.find((c) => c.id === id)?.name ?? "";
  const table = () => data.map((r) => [fmtDate(r.date), r.reference, acct(r.accountId), cat(r.categoryId), r.description ?? "", (r.direction === "in" ? "" : "-") + (Number(r.amountMinor) / 100).toFixed(2), r.currency, (Number(r.running_balance) / 100).toFixed(2), r.status]);
  const head = ["Date", "Référence", "Compte", "Catégorie", "Description", "Montant", "Devise", "Solde (validé)", "Statut"];

  return (
    <>
      <PageHeader title="Journal des transactions" icon={BookOpen}>
        {s.can("report.export") && (
          <span className="actions no-print">
            <Button size="sm" variant="outline" onClick={() => exportExcel("journal", head, table())}><FileSpreadsheet />Excel</Button>
            <Button size="sm" variant="outline" onClick={() => exportPdf(`Journal — ${s.parish?.name ?? "Consolidé"}`, head, table())}><FileText />PDF</Button>
          </span>
        )}
      </PageHeader>
      <Card title="Filtres" icon={ListFilter}>
        <div className="form-grid">
          <Field label="Du"><Input type="date" value={f.from} onChange={set("from")} /></Field>
          <Field label="Au"><Input type="date" value={f.to} onChange={set("to")} /></Field>
          <Field label="Compte"><NativeSelect value={f.accountId} onChange={set("accountId")}><option value="">Tous</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>
          <Field label="Catégorie"><NativeSelect value={f.categoryId} onChange={set("categoryId")}><option value="">Toutes</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Devise"><NativeSelect value={f.currency} onChange={set("currency")}><option value="">Toutes</option><option>CDF</option><option>USD</option></NativeSelect></Field>
          <Field label="Statut"><NativeSelect value={f.status} onChange={set("status")}><option value="">Tous</option>{["brouillon", "soumise", "validee1", "validee", "rejetee"].map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
        </div>
      </Card>
      <Card>
        <DataTable
          rows={data} loading={rows.isLoading} emptyIcon={BookOpen} empty="Aucune écriture pour ces filtres"
          columns={[
            { header: "Date", cell: (r) => fmtDate(r.date) },
            { header: "Réf.", cell: (r) => <a href="#" onClick={(e) => { e.preventDefault(); setOpen(open === r.id ? null : r.id); }}>{r.reference}</a> },
            { header: "Compte", cell: (r) => acct(r.accountId) },
            { header: "Catégorie", cell: (r) => cat(r.categoryId) },
            { header: "Entrée", align: "right", cell: (r) => (r.direction === "in" ? money(r.amountMinor, r.currency as Currency) : "") },
            { header: "Sortie", align: "right", cell: (r) => (r.direction === "out" ? money(r.amountMinor, r.currency as Currency) : "") },
            { header: "Solde", align: "right", cell: (r) => money(r.running_balance, r.currency as Currency) },
            { header: "Statut", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {open && (
          <div className="mt-3 rounded-lg border p-3">
            <h3 className="mb-2 flex items-center gap-2 font-medium"><History className="size-4 text-muted-foreground" />Historique de validation{detail.data ? ` — ${detail.data.reference}` : ""}</h3>
            {detail.isLoading ? (
              <div role="status" aria-label="Chargement" className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-3/5" /></div>
            ) : (
              <ol className="space-y-2">
                {detail.data?.events.map((e: any) => {
                  const Icon = STATUS_ICON[e.toStatus as TxStatus];
                  return (
                    <li key={e.id} className="flex items-start gap-2 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
      </Card>
    </>
  );
}

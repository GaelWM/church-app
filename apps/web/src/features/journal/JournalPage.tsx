import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useAccounts, useCategories, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { Card, DataTable, Field, StatusBadge, PageHeader } from "../../components/common";
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
      <PageHeader title="Journal des transactions">
        {s.can("report.export") && (
          <span className="actions no-print">
            <Button size="sm" variant="outline" onClick={() => exportExcel("journal", head, table())}>Excel</Button>
            <Button size="sm" variant="outline" onClick={() => exportPdf(`Journal — ${s.parish?.name ?? "Consolidé"}`, head, table())}>PDF</Button>
          </span>
        )}
      </PageHeader>
      <Card>
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
          rows={data}
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
        {open && detail.data && (
          <div className="mt-3 rounded-lg border p-3">
            <h3 className="mb-1 font-medium">Historique de validation — {detail.data.reference}</h3>
            <ul>{detail.data.events.map((e: any) => <li key={e.id}>{new Date(e.at).toLocaleString("fr-FR")} — {e.actorName} : {e.fromStatus ?? "∅"} → {e.toStatus}{e.comment ? ` (${e.comment})` : ""}</li>)}</ul>
          </div>
        )}
      </Card>
    </>
  );
}

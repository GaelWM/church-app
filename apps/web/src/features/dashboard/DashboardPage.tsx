import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money, usd } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { Card, DataTable, Provisional, PageHeader } from "../../components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

interface Dash {
  provisional: boolean;
  balances: { id: string; name: string; currency: Currency; type: string; balance: string }[];
  monthly: { month: string; kind: string; currency: string; total: string; total_usd: string }[];
  topCategories: { name: string; kind: string; total_usd: string; recent_half_usd: string; previous_half_usd: string }[];
  pending: { awaiting_first: number; awaiting_second: number };
  pledges: { id: string; donor_name: string | null; currency: Currency; promised: string; received: string }[];
  obligations: { id: string; payee: string; currency: Currency; amount: string; due_date: string | null }[];
  attendance: { service_date: string; service_type: string; total: number; offering_usd: string }[];
}

export function DashboardPage() {
  const api = useApi();
  const s = useSession();
  const [provisional, setProvisional] = useState(false);
  const q = useQuery({ queryKey: useScopedKey("dashboard", provisional), queryFn: () => api.get<Dash>("/dashboard", provisional ? { provisional: "1" } : undefined) });
  const d = q.data;
  if (!d) return <p className="muted">Chargement…</p>;

  const total = (cur: Currency) => d.balances.filter((b) => b.currency === cur).reduce((a, b) => a + BigInt(b.balance), 0n);
  // Combined USD-equivalent uses each entry's own stored rate for flows; balances are shown per currency, never silently converted.
  const months = [...new Set(d.monthly.map((m) => m.month))];
  const flow = (month: string, kind: string) => d.monthly.filter((m) => m.month === month && m.kind === kind).reduce((a, m) => a + BigInt(m.total_usd), 0n);
  const max = months.reduce((a, m) => { const v = flow(m, "recette") > flow(m, "depense") ? flow(m, "recette") : flow(m, "depense"); return v > a ? v : a; }, 1n);
  const myPending = (s.can("transaction.validate1") ? d.pending.awaiting_first : 0) + (s.can("transaction.validate2") ? d.pending.awaiting_second : 0);

  return (
    <>
      <PageHeader title={<>Tableau de bord {d.provisional && <Provisional />}</>}>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={provisional} onCheckedChange={(v) => setProvisional(v === true)} /> Inclure les écritures en attente (provisoire)</label>
      </PageHeader>

      <div className="stat-grid">
        <Card title="Total CDF"><div className="stat">{money(total("CDF"), "CDF")}</div></Card>
        <Card title="Total USD"><div className="stat">{money(total("USD"), "USD")}</div></Card>
        {myPending > 0 && <Card title="À valider par vous"><div className="stat">{myPending}</div></Card>}
      </div>

      <Card title="Soldes par compte">
        <DataTable rows={d.balances} columns={[{ header: "Compte", cell: (b) => b.name }, { header: "Type", cell: (b) => b.type }, { header: "Solde", align: "right", cell: (b) => money(b.balance, b.currency) }]} />
      </Card>

      <Card title="Recettes et dépenses par mois (équivalent USD)">
        {months.length === 0 && <p className="muted">Aucune donnée.</p>}
        {months.map((m) => (
          <div key={m} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>{m}</b><span>Résultat net : {usd(flow(m, "recette") - flow(m, "depense"))}</span></div>
            <div className="h-2 overflow-hidden rounded bg-muted" title="Recettes"><i className="block h-full" style={{ width: `${Number((flow(m, "recette") * 100n) / max)}%`, background: "var(--color-emerald-600)" }} /></div>
            <div className="mt-0.5 h-2 overflow-hidden rounded bg-muted" title="Dépenses"><i className="block h-full" style={{ width: `${Number((flow(m, "depense") * 100n) / max)}%`, background: "var(--destructive)" }} /></div>
            <small className="text-muted-foreground">Recettes {usd(flow(m, "recette"))} · Dépenses {usd(flow(m, "depense"))}</small>
          </div>
        ))}
      </Card>

      <Card title="Principales catégories (comparées à la période précédente)">
        <DataTable rows={d.topCategories.map((c) => ({ ...c, id: c.kind + c.name }))} columns={[
          { header: "Catégorie", cell: (c) => c.name }, { header: "Type", cell: (c) => c.kind },
          { header: "Total", align: "right", cell: (c) => usd(c.total_usd) },
          { header: "Récent vs précédent", align: "right", cell: (c) => { const r = Number(c.recent_half_usd), p = Number(c.previous_half_usd); return p ? `${r >= p ? "+" : ""}${Math.round(((r - p) / p) * 100)} %` : "—"; } },
        ]} />
      </Card>

      <div className="stat-grid">
        <Card title="Promesses de dons">
          <DataTable rows={d.pledges} columns={[
            { header: "Donateur", cell: (p) => p.donor_name ?? "—" }, { header: "Promis", align: "right", cell: (p) => money(p.promised, p.currency) },
            { header: "Reçu", align: "right", cell: (p) => money(p.received, p.currency) }, { header: "Reste", align: "right", cell: (p) => money(BigInt(p.promised) - BigInt(p.received), p.currency) },
          ]} />
        </Card>
        <Card title="Engagements de dépenses à venir">
          <DataTable rows={d.obligations} columns={[
            { header: "Bénéficiaire", cell: (o) => o.payee }, { header: "Échéance", cell: (o) => fmtDate(o.due_date) }, { header: "Montant", align: "right", cell: (o) => money(o.amount, o.currency) },
          ]} />
        </Card>
      </div>

      <Card title="Effectifs et offrande moyenne par personne">
        <DataTable rows={d.attendance.map((a, i) => ({ ...a, id: String(i) }))} columns={[
          { header: "Date", cell: (a) => fmtDate(a.service_date) }, { header: "Culte", cell: (a) => a.service_type }, { header: "Présents", align: "right", cell: (a) => a.total },
          { header: "Offrande / personne", align: "right", cell: (a) => (a.total ? usd(Math.round(Number(a.offering_usd) / a.total)) : "—") },
        ]} />
      </Card>
    </>
  );
}

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money, usd } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { BarChart3, Banknote, CheckCheck, CircleDollarSign, Coins, HandCoins, Landmark, ReceiptText, Smartphone, Tags, TrendingDown, TrendingUp, Users, Wallet, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Card, DataTable, Provisional, PageHeader, StatCard } from "../../components/common";
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

const ACCOUNT_ICON: Record<string, LucideIcon> = { caisse: Banknote, banque: Landmark, mobile_money: Smartphone };

export function DashboardPage() {
  const api = useApi();
  const s = useSession();
  const [provisional, setProvisional] = useState(false);
  const q = useQuery({
    queryKey: useScopedKey("dashboard", provisional),
    queryFn: () => api.get<Dash>("/dashboard", provisional ? { provisional: "1" } : undefined),
    placeholderData: keepPreviousData, // toggling "provisoire" keeps the old numbers visible instead of flashing empty
  });
  const d = q.data;
  const loading = q.isLoading;

  const balances = d?.balances ?? [];
  const total = (cur: Currency) => balances.filter((b) => b.currency === cur).reduce((a, b) => a + BigInt(b.balance), 0n);
  // Flows use each entry's own stored rate; balances are shown per currency, never silently converted.
  const months = [...new Set((d?.monthly ?? []).map((m) => m.month))];
  const flow = (month: string, kind: string) => (d?.monthly ?? []).filter((m) => m.month === month && m.kind === kind).reduce((a, m) => a + BigInt(m.total_usd), 0n);
  const max = months.reduce((a, m) => { const v = flow(m, "recette") > flow(m, "depense") ? flow(m, "recette") : flow(m, "depense"); return v > a ? v : a; }, 1n);
  const myPending = d ? (s.can("transaction.validate1") ? d.pending.awaiting_first : 0) + (s.can("transaction.validate2") ? d.pending.awaiting_second : 0) : 0;

  return (
    <>
      <PageHeader title={<>Tableau de bord {d?.provisional && <Provisional />}</>} icon={BarChart3}>
        <span className="flex items-center gap-3">
          {q.isFetching && !loading && <Spinner className="text-muted-foreground" />}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={provisional} onCheckedChange={(v) => setProvisional(v === true)} /> Inclure les écritures en attente (provisoire)</label>
        </span>
      </PageHeader>

      <div className="stat-grid">
        <StatCard label="Total CDF" icon={Coins} loading={loading} value={money(total("CDF"), "CDF")} />
        <StatCard label="Total USD" icon={CircleDollarSign} loading={loading} value={money(total("USD"), "USD")} />
        {(loading || myPending > 0) && <StatCard label="À valider par vous" icon={CheckCheck} loading={loading} value={myPending} />}
      </div>

      <Card title="Soldes par compte" icon={Wallet}>
        <DataTable loading={loading} emptyIcon={Wallet} empty="Aucun compte" rows={balances} columns={[
          { header: "Compte", cell: (b) => { const Icon = ACCOUNT_ICON[b.type] ?? Wallet; return <span className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" />{b.name}</span>; } },
          { header: "Type", cell: (b) => b.type }, { header: "Solde", align: "right", cell: (b) => money(b.balance, b.currency) },
        ]} />
      </Card>

      <Card title="Recettes et dépenses par mois (équivalent USD)" icon={BarChart3}>
        {loading && <div role="status" aria-label="Chargement" className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="space-y-1.5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-2 w-full" /><Skeleton className="h-2 w-2/3" /></div>)}</div>}
        {!loading && months.length === 0 && <p className="muted">Aucune donnée.</p>}
        {months.map((m) => (
          <div key={m} className="mb-2.5">
            <div className="flex justify-between"><b>{m}</b><span className="flex items-center gap-1.5">{flow(m, "recette") >= flow(m, "depense") ? <TrendingUp className="size-4 text-emerald-600" /> : <TrendingDown className="size-4 text-destructive" />}Résultat net : {usd(flow(m, "recette") - flow(m, "depense"))}</span></div>
            <div className="h-2 overflow-hidden rounded bg-muted" title="Recettes"><i className="block h-full" style={{ width: `${Number((flow(m, "recette") * 100n) / max)}%`, background: "var(--color-emerald-600)" }} /></div>
            <div className="mt-0.5 h-2 overflow-hidden rounded bg-muted" title="Dépenses"><i className="block h-full" style={{ width: `${Number((flow(m, "depense") * 100n) / max)}%`, background: "var(--destructive)" }} /></div>
            <small className="text-muted-foreground">Recettes {usd(flow(m, "recette"))} · Dépenses {usd(flow(m, "depense"))}</small>
          </div>
        ))}
      </Card>

      <Card title="Principales catégories (comparées à la période précédente)" icon={Tags}>
        <DataTable loading={loading} emptyIcon={Tags} empty="Aucune écriture validée sur la période" rows={(d?.topCategories ?? []).map((c) => ({ ...c, id: c.kind + c.name }))} columns={[
          { header: "Catégorie", cell: (c) => c.name }, { header: "Type", cell: (c) => c.kind },
          { header: "Total", align: "right", cell: (c) => usd(c.total_usd) },
          { header: "Récent vs précédent", align: "right", cell: (c) => {
            const r = Number(c.recent_half_usd), p = Number(c.previous_half_usd);
            if (!p) return "—";
            const up = r >= p;
            return <span className={`inline-flex items-center gap-1 ${up ? "text-emerald-600" : "text-destructive"}`}>{up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}{up ? "+" : ""}{Math.round(((r - p) / p) * 100)} %</span>;
          } },
        ]} />
      </Card>

      <div className="stat-grid">
        <Card title="Promesses de dons" icon={HandCoins}>
          <DataTable loading={loading} emptyIcon={HandCoins} empty="Aucune promesse" rows={d?.pledges ?? []} columns={[
            { header: "Donateur", cell: (p) => p.donor_name ?? "—" }, { header: "Promis", align: "right", cell: (p) => money(p.promised, p.currency) },
            { header: "Reçu", align: "right", cell: (p) => money(p.received, p.currency) }, { header: "Reste", align: "right", cell: (p) => money(BigInt(p.promised) - BigInt(p.received), p.currency) },
          ]} />
        </Card>
        <Card title="Engagements de dépenses à venir" icon={ReceiptText}>
          <DataTable loading={loading} emptyIcon={ReceiptText} empty="Aucun engagement à venir" rows={d?.obligations ?? []} columns={[
            { header: "Bénéficiaire", cell: (o) => o.payee }, { header: "Échéance", cell: (o) => fmtDate(o.due_date) }, { header: "Montant", align: "right", cell: (o) => money(o.amount, o.currency) },
          ]} />
        </Card>
      </div>

      <Card title="Effectifs et offrande moyenne par personne" icon={Users}>
        <DataTable loading={loading} emptyIcon={Users} empty="Aucun comptage validé" rows={(d?.attendance ?? []).map((a, i) => ({ ...a, id: String(i) }))} columns={[
          { header: "Date", cell: (a) => fmtDate(a.service_date) }, { header: "Culte", cell: (a) => a.service_type }, { header: "Présents", align: "right", cell: (a) => a.total },
          { header: "Offrande / personne", align: "right", cell: (a) => (a.total ? usd(Math.round(Number(a.offering_usd) / a.total)) : "—") },
        ]} />
      </Card>
    </>
  );
}

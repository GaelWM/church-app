import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, fmtMonth, label, usd } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, Money, PageHeader, Provisional, Section } from "../../components/common";
import { cn } from "@/lib/utils";

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

function Segmented({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opt = (v: boolean, text: string) => (
    <button type="button" aria-pressed={value === v} onClick={() => onChange(v)}
      className={cn("rounded px-3 py-1 text-sm transition-colors", value === v ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>{text}</button>
  );
  return <div role="group" aria-label="Périmètre des écritures" className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">{opt(false, "Validées")}{opt(true, "Avec en attente")}</div>;
}

/** Paired income/expense columns per month (USD equivalent). Hover a column for the exact amounts. */
function MonthlyChart({ months, flow }: { months: string[]; flow: (m: string, kind: string) => bigint }) {
  const shown = months.slice(-12);
  const max = shown.reduce((a, m) => [flow(m, "recette"), flow(m, "depense")].reduce((x, v) => (v > x ? v : x), a), 1n);
  const pct = (v: bigint) => Math.max(v > 0n ? 2 : 0, Number((v * 100n) / max));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-1" />Recettes</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-2" />Dépenses</span>
      </div>
      <div className="flex h-44 items-end gap-3 border-b">
        {shown.map((m) => {
          const r = flow(m, "recette"), d = flow(m, "depense");
          return (
            <div key={m} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1" title={`${fmtMonth(m)} — recettes ${usd(r)}, dépenses ${usd(d)}, net ${usd(r - d)}`}>
              <div className="w-full max-w-8 rounded-t-sm bg-chart-1" style={{ height: `${pct(r)}%` }} />
              <div className="w-full max-w-8 rounded-t-sm bg-chart-2" style={{ height: `${pct(d)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3">{shown.map((m) => <span key={m} className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">{fmtMonth(m)}</span>)}</div>
    </div>
  );
}

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
  const months = [...new Set((d?.monthly ?? []).map((m) => m.month))].sort();
  const flow = (month: string, kind: string) => (d?.monthly ?? []).filter((m) => m.month === month && m.kind === kind).reduce((a, m) => a + BigInt(m.total_usd), 0n);
  const latest = months.at(-1);
  const net = latest ? flow(latest, "recette") - flow(latest, "depense") : 0n;
  const myPending = d ? (s.can("transaction.validate1") ? d.pending.awaiting_first : 0) + (s.can("transaction.validate2") ? d.pending.awaiting_second : 0) : 0;

  return (
    <>
      <PageHeader title={<>Tableau de bord {d?.provisional && <Provisional />}</>}>
        <span className="flex items-center gap-3">
          {q.isFetching && !loading && <Spinner className="text-muted-foreground" />}
          <Segmented value={provisional} onChange={setProvisional} />
        </span>
      </PageHeader>

      <div className="mb-10 grid grid-cols-2 gap-x-6 border-b pb-8 sm:gap-x-10 lg:grid-cols-[1fr_1fr_1fr]">
        {(["CDF", "USD"] as const).map((cur, i) => (
          <div key={cur} className={cn("min-w-0", i > 0 && "border-l pl-4 sm:pl-10")}>
            <div className="label-caps">Solde {cur}</div>
            {loading ? <Skeleton className="mt-2 h-10 w-44" /> : <Money value={total(cur)} currency={cur} className="stat mt-1 block text-2xl sm:text-5xl" />}
          </div>
        ))}
        <div className="col-span-2 mt-6 border-t pt-4 lg:col-span-1 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
          {myPending > 0 ? (
            <>
              <div className="label-caps">À valider par vous</div>
              <div className="stat mt-1 text-2xl sm:text-5xl">{myPending}</div>
              <Link to="/validation" className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline">Ouvrir la file de validation</Link>
            </>
          ) : latest && (
            <>
              <div className="label-caps">Résultat net · {fmtMonth(latest)}</div>
              <Money value={net} currency="USD" className={cn("stat mt-1 block text-2xl sm:text-5xl", net < 0n && "text-destructive")} />
              <div className="mt-1 text-sm text-muted-foreground">équivalent USD</div>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <Section title="Recettes et dépenses par mois" actions="équivalent USD">
            {loading ? <Skeleton className="mt-4 h-44 w-full" /> : months.length === 0 ? <p className="py-6 text-sm text-foreground/80">Aucune écriture validée pour l'instant.</p> : <div className="pt-4"><MonthlyChart months={months} flow={flow} /></div>}
          </Section>

          <Section title="Soldes par compte">
            <DataTable loading={loading} empty="Aucun compte configuré" rows={balances} columns={[
              { header: "Compte", cell: (b) => <><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{label(b.type)}</div></> },
              { header: "Solde", align: "right", cell: (b) => <Money value={b.balance} currency={b.currency} /> },
            ]} />
          </Section>
        </div>

        <div>
          <Section title="Principales catégories" actions="vs période précédente">
            <DataTable loading={loading} empty="Aucune écriture validée sur la période" rows={(d?.topCategories ?? []).map((c) => ({ ...c, id: c.kind + c.name }))} columns={[
              { header: "Catégorie", cell: (c) => <><div>{c.name}</div><div className="text-xs text-muted-foreground">{label(c.kind)}</div></> },
              { header: "Total", align: "right", cell: (c) => <Money value={c.total_usd} currency="USD" /> },
              { header: "Tendance", align: "right", cell: (c) => {
                const r = Number(c.recent_half_usd), p = Number(c.previous_half_usd);
                if (!p) return <span className="text-muted-foreground">—</span>;
                const up = r >= p;
                return <span className={cn("tabular-nums", up ? "text-success" : "text-destructive")}>{up ? "▲ +" : "▼ "}{Math.round(((r - p) / p) * 100)} %</span>;
              } },
            ]} />
          </Section>

          <Section title="Promesses de dons">
            <DataTable loading={loading} empty="Aucune promesse en cours" rows={d?.pledges ?? []} columns={[
              { header: "Donateur", cell: (p) => p.donor_name ?? "—" },
              { header: "Reste à recevoir", align: "right", cell: (p) => <Money value={BigInt(p.promised) - BigInt(p.received)} currency={p.currency} /> },
            ]} />
          </Section>

          <Section title="Dépenses à venir">
            <DataTable loading={loading} empty="Aucun engagement à venir" rows={d?.obligations ?? []} columns={[
              { header: "Bénéficiaire", cell: (o) => <><div>{o.payee}</div><div className="text-xs text-muted-foreground">{fmtDate(o.due_date)}</div></> },
              { header: "Montant", align: "right", cell: (o) => <Money value={o.amount} currency={o.currency} /> },
            ]} />
          </Section>

          <Section title="Effectifs" actions="offrande moyenne par personne">
            <DataTable loading={loading} empty="Aucun comptage validé" rows={(d?.attendance ?? []).map((a, i) => ({ ...a, id: String(i) }))} columns={[
              { header: "Culte", cell: (a) => <><div>{a.service_type}</div><div className="text-xs text-muted-foreground">{fmtDate(a.service_date)}</div></> },
              { header: "Présents", align: "right", cell: (a) => a.total },
              { header: "Par personne", align: "right", cell: (a) => (a.total ? <Money value={Math.round(Number(a.offering_usd) / a.total)} currency="USD" /> : "—") },
            ]} />
          </Section>
        </div>
      </div>
    </>
  );
}

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, fmtMonth, label, money, usd } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DateRangePicker, dateLimits } from "../../components/form-controls";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, Field, Money, PageHeader, Provisional, Section } from "../../components/common";
import { cn } from "@/lib/utils";

interface Dash {
  provisional: boolean;
  balances: { id: string; name: string; currency: Currency; type: string; balance: string }[];
  monthly: { month: string; kind: string; currency: string; total: string; total_usd: string }[];
  topCategories: { name: string; kind: string; total_usd: string; recent_half_usd: string; previous_half_usd: string }[];
  pending: { awaiting_first: number; awaiting_second: number };
  pledges: { id: string; donor_name: string | null; currency: Currency; promised: string; received: string }[];
  obligations: { id: string; payee: string; currency: Currency; amount: string; due_date: string | null }[];
  currency: Currency | null;
  totals: { currency: Currency; recettes: string; depenses: string }[];
  byCategory: { kind: string; name: string; currency: Currency; total: string; total_usd: string }[];
  engagements: { pledges: Eng[]; commitments: Eng[] };
  negativeAlerts: { id: string; name: string; currency: Currency; balance: string }[];
  attendance: { service_date: string; service_type: string; total: number; offering_usd: string }[];
}

interface Eng { type: string; currency: Currency; engaged: string; released: string; remaining: string }
const ENG_TYPES: Record<string, string> = { construction: "Construction", partenariat: "Partenariat", parcelle: "Parcelle", autre: "Autre" };

/** Horizontal bars: one row per category, sorted by amount; exact figure printed on each row (readable without hover). */
function CategoryBars({ rows, color }: { rows: { name: string; v: bigint; label: string }[]; color: string }) {
  const max = rows.reduce((a, r) => (r.v > a ? r.v : a), 1n);
  if (!rows.length) return <p className="py-4 text-sm text-muted-foreground">Aucune écriture validée sur la période.</p>;
  return (
    <ul className="space-y-2 pt-3">
      {rows.slice(0, 8).map((r) => (
        <li key={r.name} className="text-sm">
          <div className="flex justify-between gap-3"><span className="truncate">{r.name}</span><span className="tabular-nums text-muted-foreground">{r.label}</span></div>
          <div className="mt-1 h-2 rounded-sm bg-muted"><div className={cn("h-2 rounded-sm", color)} style={{ width: `${Math.max(2, Number((r.v * 100n) / max))}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

const goto = (to: string, text: string) => <Link to={to} className="text-primary underline-offset-4 hover:underline">{text}</Link>;

function Segmented({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opt = (v: boolean, text: string) => (
    <button type="button" aria-pressed={value === v} onClick={() => onChange(v)}
      className={cn("rounded px-3 py-1 text-sm transition-colors", value === v ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>{text}</button>
  );
  return <div role="group" aria-label="Périmètre des écritures" className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">{opt(false, "Validées")}{opt(true, "Avec en attente")}</div>;
}

/** Paired income/expense columns per month (USD equivalent). Hover a column for the exact amounts. */
function MonthlyChart({ months, flow, fmt, unit }: { months: string[]; flow: (m: string, kind: string) => bigint; fmt: (v: bigint) => string; unit: string }) {
  const shown = months.slice(-12);
  const max = shown.reduce((a, m) => [flow(m, "recette"), flow(m, "depense")].reduce((x, v) => (v > x ? v : x), a), 1n);
  const pct = (v: bigint) => Math.max(v > 0n ? 2 : 0, Number((v * 100n) / max));
  const compact = (v: bigint) => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v) / 100);
  const withValues = shown.length <= 6; // beyond that the labels collide; the tooltip and the accessible summary still carry the amounts
  const summary = shown.map((m) => `${fmtMonth(m)} : recettes ${fmt(flow(m, "recette"))}, dépenses ${fmt(flow(m, "depense"))}`).join(". ");
  const bar = (v: bigint, color: string) => (
    <div className={cn("relative w-full max-w-10 rounded-t-sm", color)} style={{ height: `${pct(v)}%` }}>
      {withValues && <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs tabular-nums text-muted-foreground">{compact(v)}</span>}
    </div>
  );
  return (
    <div role="img" aria-label={`Recettes et dépenses par mois, ${unit}. ${summary}`}>
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-1" />Recettes</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-2" />Dépenses</span>
      </div>
      <div aria-hidden className="flex h-48 items-end gap-3 border-b pt-5">
        {shown.map((m) => {
          const r = flow(m, "recette"), d = flow(m, "depense");
          return (
            <div key={m} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1" title={`${fmtMonth(m)} — recettes ${fmt(r)}, dépenses ${fmt(d)}, net ${fmt(r - d)}`}>
              {bar(r, "bg-chart-1")}
              {bar(d, "bg-chart-2")}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="mt-1.5 flex gap-3">{shown.map((m) => <span key={m} className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">{fmtMonth(m)}</span>)}</div>
    </div>
  );
}

export function DashboardPage() {
  const api = useApi();
  const s = useSession();
  const [provisional, setProvisional] = useState(false);
  const [f, setF] = useState({ from: "", to: "", currency: "" });
  const q = useQuery({
    queryKey: useScopedKey("dashboard", provisional, f),
    queryFn: () => api.get<Dash>("/dashboard", { ...(provisional ? { provisional: "1" } : {}), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }),
    placeholderData: keepPreviousData, // changing a filter keeps the old numbers visible instead of flashing empty
  });
  const d = q.data;
  const loading = q.isLoading;
  const cur = (f.currency || null) as Currency | null;

  const balances = d?.balances ?? [];
  const currencies = (cur ? [cur] : ["CDF", "USD"]) as Currency[];
  const dispo = (c: Currency) => balances.filter((b) => b.currency === c).reduce((a, b) => a + BigInt(b.balance), 0n);
  const tot = (c: Currency, k: "recettes" | "depenses") => BigInt(d?.totals.find((t) => t.currency === c)?.[k] ?? 0);
  // One currency selected: native amounts. All currencies: USD equivalent at each entry's own rate (never a silent conversion of balances).
  const fmt = (v: bigint) => (cur ? money(v, cur) : usd(v));
  const unit = cur ? cur : "équivalent USD";
  const months = [...new Set((d?.monthly ?? []).map((m) => m.month))].sort();
  const flow = (month: string, kind: string) => (d?.monthly ?? []).filter((m) => m.month === month && m.kind === kind).reduce((a, m) => a + BigInt(cur ? m.total : m.total_usd), 0n);
  const catRows = (kind: string) => {
    const acc = new Map<string, bigint>();
    for (const r of d?.byCategory ?? []) if (r.kind === kind) acc.set(r.name, (acc.get(r.name) ?? 0n) + BigInt(cur ? r.total : r.total_usd));
    return [...acc].sort((a, b) => (b[1] > a[1] ? 1 : -1)).map(([name, v]) => ({ name, v, label: fmt(v) }));
  };
  const myPending = d ? (s.can("transaction.validate1") ? d.pending.awaiting_first : 0) + (s.can("transaction.validate2") ? d.pending.awaiting_second : 0) : 0;
  const engRows = (kind: "pledges" | "commitments") => (d?.engagements[kind] ?? []).map((e) => ({ ...e, id: e.type + e.currency }));
  const engCols = (kind: string) => [
    { header: kind, cell: (e: Eng) => ENG_TYPES[e.type] ?? e.type },
    { header: "Engagé", align: "right" as const, cell: (e: Eng) => <Money value={e.engaged} currency={e.currency} /> },
    { header: "Libéré", align: "right" as const, cell: (e: Eng) => <Money value={e.released} currency={e.currency} /> },
    { header: "Non libéré", align: "right" as const, cell: (e: Eng) => <Money value={e.remaining} currency={e.currency} /> },
  ];

  return (
    <>
      <PageHeader title={<>Tableau de bord {d?.provisional && <Provisional />}</>}>
        <span className="flex items-center gap-3">
          {q.isFetching && !loading && <Spinner className="text-muted-foreground" />}
          <Segmented value={provisional} onChange={setProvisional} />
        </span>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="Période"><DateRangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} max={dateLimits.past().max} placeholder="12 derniers mois" /></Field>
        <div role="group" aria-label="Devise" className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
          {([["", "Toutes"], ["CDF", "CDF"], ["USD", "USD"]] as const).map(([v, t]) => (
            <button key={v} type="button" aria-pressed={f.currency === v} onClick={() => setF({ ...f, currency: v })}
              className={cn("rounded px-3 py-1 text-sm transition-colors", f.currency === v ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>{t}</button>
          ))}
        </div>
        {(f.from || f.to || f.currency) && <button type="button" className="text-sm text-primary underline-offset-4 hover:underline" onClick={() => setF({ from: "", to: "", currency: "" })}>Réinitialiser</button>}
      </div>

      {!!d?.negativeAlerts.length && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Solde négatif</AlertTitle>
          <AlertDescription>
            <ul>{d.negativeAlerts.map((a) => <li key={a.id}>{a.name} : <Money value={a.balance} currency={a.currency} /></li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-10 grid grid-cols-2 gap-x-6 gap-y-6 border-b pb-8 lg:grid-cols-4">
        {[
          { title: "Recettes cumulées", val: (c: Currency) => tot(c, "recettes"), tone: "" },
          { title: "Dépenses cumulées", val: (c: Currency) => tot(c, "depenses"), tone: "" },
          { title: "Disponibilités", val: dispo, tone: "" },
        ].map((k) => (
          <div key={k.title} className="min-w-0">
            <div className="label-caps">{k.title}</div>
            {loading ? <Skeleton className="mt-2 h-8 w-40" /> : currencies.map((c) => <Money key={c} value={k.val(c)} currency={c} className={cn("stat mt-1 block text-xl sm:text-3xl", k.val(c) < 0n && "text-destructive")} />)}
          </div>
        ))}
        <div className="min-w-0">
          {myPending > 0 ? (
            <>
              <div className="label-caps">À valider par vous</div>
              <div className="stat mt-1 text-xl sm:text-3xl">{myPending}</div>
              <Link to="/validation" className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline">Ouvrir la file de validation</Link>
            </>
          ) : (
            <>
              <div className="label-caps">Résultat net</div>
              {loading ? <Skeleton className="mt-2 h-8 w-40" /> : currencies.map((c) => { const n = tot(c, "recettes") - tot(c, "depenses"); return <Money key={c} value={n} currency={c} className={cn("stat mt-1 block text-xl sm:text-3xl", n < 0n && "text-destructive")} />; })}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <Section title="Évolution des recettes et dépenses" actions={unit}>
            {loading ? <Skeleton className="mt-4 h-44 w-full" /> : months.length === 0 ? <div className="py-6 text-sm"><p className="text-foreground/80">Aucune écriture validée sur la période.</p><p className="mt-2">{goto("/recettes", "Enregistrer une recette")}</p></div> : <div className="pt-4"><MonthlyChart months={months} flow={flow} fmt={fmt} unit={unit} /></div>}
          </Section>

          <div className="grid gap-x-8 sm:grid-cols-2">
            <Section title="Recettes par catégorie" actions={unit}>{loading ? <Skeleton className="mt-4 h-32 w-full" /> : <CategoryBars rows={catRows("recette")} color="bg-chart-1" />}</Section>
            <Section title="Dépenses par catégorie" actions={unit}>{loading ? <Skeleton className="mt-4 h-32 w-full" /> : <CategoryBars rows={catRows("depense")} color="bg-chart-2" />}</Section>
          </div>

          <Section title="Soldes par compte">
            <DataTable loading={loading} empty="Aucun compte configuré" rows={balances} columns={[
              { header: "Compte", cell: (b) => <><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{label(b.type)}</div></> },
              { header: "Solde", align: "right", cell: (b) => <Money value={b.balance} currency={b.currency} className={cn(BigInt(b.balance) < 0n && "text-destructive")} /> },
            ]} />
          </Section>
        </div>

        <div>
          <Section title="Engagements">
            <DataTable loading={loading} empty="Aucune promesse" emptyAction={goto("/engagements", "Enregistrer une promesse")} rows={engRows("pledges")} columns={engCols("Promesses de dons")} />
            <div className="h-4" />
            <DataTable loading={loading} empty="Aucun engagement de dépense" rows={engRows("commitments")} columns={engCols("Engagements de dépenses")} />
          </Section>

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

          <Section title="Dépenses à venir">
            <DataTable loading={loading} empty="Aucun engagement à venir" emptyAction={goto("/engagements", "Enregistrer un engagement")} rows={d?.obligations ?? []} columns={[
              { header: "Bénéficiaire", cell: (o) => <><div>{o.payee}</div><div className="text-xs text-muted-foreground">{fmtDate(o.due_date)}</div></> },
              { header: "Montant", align: "right", cell: (o) => <Money value={o.amount} currency={o.currency} /> },
            ]} />
          </Section>

          <Section title="Effectifs" actions="offrande moyenne par personne">
            <DataTable loading={loading} empty="Aucun comptage validé" emptyAction={goto("/effectifs", "Saisir un comptage")} rows={(d?.attendance ?? []).map((a, i) => ({ ...a, id: String(i) }))} columns={[
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

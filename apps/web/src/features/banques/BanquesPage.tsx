import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAmount, type Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money, today } from "../../core/format";
import { useAccounts, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { Card, DataTable, ErrorNote, Field } from "../../components/ui";

const OPS = [
  ["versement", "Versement (caisse vers banque)"], ["retrait", "Retrait (banque vers caisse)"], ["virement", "Virement entre comptes"],
  ["change", "Opération de change"], ["frais", "Frais bancaires et commissions"], ["interets", "Intérêts créditeurs"],
] as const;

export function BanquesPage() {
  const s = useSession();
  const [tab, setTab] = useState<"operations" | "rapprochement" | "periodes">("operations");
  return (
    <>
      <div className="topbar"><h2>Banques</h2></div>
      <div className="tabs">
        {(["operations", "rapprochement", "periodes"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{{ operations: "Opérations", rapprochement: "Rapprochement bancaire", periodes: "Clôture mensuelle" }[t]}</button>
        ))}
      </div>
      {tab === "operations" && <Operations canEnter={s.can("transaction.create") && !s.consolidated} />}
      {tab === "rapprochement" && <Reconciliation />}
      {tab === "periodes" && <Periods />}
    </>
  );
}

function Operations({ canEnter }: { canEnter: boolean }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const accounts = useAccounts();
  const [type, setType] = useState<(typeof OPS)[number][0]>("versement");
  const [v, setV] = useState({ from: "", to: "", account: "", amount: "", rate: "", date: today(), description: "" });
  const single = type === "frais" || type === "interets";
  const rows = useQuery({ queryKey: useScopedKey("bank-tx"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "transfert,change" }) });
  const create = useMutation({
    mutationFn: () => api.post("/banking/operations", {
      type, date: v.date, description: v.description || undefined, amountMinor: parseAmount(v.amount).toString(),
      ...(single ? { accountId: v.account } : { fromAccountId: v.from, toAccountId: v.to }),
      ...(type === "change" ? { actualRateCdfPerUsd: v.rate.replace(",", ".") } : {}),
    }),
    onSuccess: () => { setV({ ...v, amount: "", description: "" }); invalidate(); },
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const opts = <>{accounts.data?.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</>;
  return (
    <>
      {canEnter && (
        <Card title="Nouvelle opération">
          <div className="form-grid">
            <Field label="Opération"><select value={type} onChange={(e) => setType(e.target.value as any)}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Date"><input type="date" value={v.date} onChange={set("date")} /></Field>
            {single ? <Field label="Compte"><select value={v.account} onChange={set("account")}><option value="">—</option>{opts}</select></Field> : (
              <>
                <Field label="De"><select value={v.from} onChange={set("from")}><option value="">—</option>{opts}</select></Field>
                <Field label="Vers"><select value={v.to} onChange={set("to")}><option value="">—</option>{opts}</select></Field>
              </>
            )}
            <Field label="Montant (devise du compte source)"><input inputMode="decimal" value={v.amount} onChange={set("amount")} placeholder="0,00" /></Field>
            {type === "change" && <Field label="Taux obtenu (1 USD = X CDF)"><input inputMode="decimal" value={v.rate} onChange={set("rate")} /></Field>}
            <Field label="Description"><input value={v.description} onChange={set("description")} /></Field>
            <button disabled={create.isPending} onClick={() => create.mutate()}>Enregistrer (brouillon)</button>
          </div>
          <ErrorNote error={create.error} />
        </Card>
      )}
      <Card title="Virements et changes">
        <DataTable<Tx> rows={rows.data ?? []} columns={[
          { header: "Réf.", cell: (t) => t.reference }, { header: "Date", cell: (t) => fmtDate(t.date) },
          { header: "Type", cell: (t) => t.kind }, { header: "Compte", cell: (t) => accounts.data?.find((a) => a.id === t.accountId)?.name ?? "" },
          { header: "Sens", cell: (t) => (t.direction === "in" ? "Entrée" : "Sortie") },
          { header: "Montant", align: "right", cell: (t) => money(t.amountMinor, t.currency as Currency) }, { header: "Statut", cell: (t) => t.status },
        ]} />
        <p className="muted">Les écritures se soumettent et se valident depuis « À valider » (les deux lignes d'un transfert ensemble).</p>
      </Card>
    </>
  );
}

function Reconciliation() {
  const api = useApi();
  const s = useSession();
  const accounts = useAccounts();
  const invalidate = useInvalidateLedger();
  const now = new Date();
  const [accountId, setAccountId] = useState("");
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [year, month] = ym.split("-").map(Number);
  const data = useQuery({ queryKey: useScopedKey("recon", accountId, ym), enabled: !!accountId && !s.consolidated, queryFn: () => api.get<{ matched: Tx[]; unmatched: Tx[] }>("/banking/reconciliation", { accountId, year: String(year), month: String(month) }) });
  const toggle = useMutation({ mutationFn: (p: { ids: string[]; matched: boolean }) => api.post("/banking/reconciliation", p), onSuccess: invalidate });
  const canTick = s.can("reconcile");
  const cols = (matched: boolean) => [
    { header: "Date", cell: (t: Tx) => fmtDate(t.date) }, { header: "Réf.", cell: (t: Tx) => t.reference }, { header: "Description", cell: (t: Tx) => t.description ?? "" },
    { header: "Montant", align: "right" as const, cell: (t: Tx) => (t.direction === "in" ? "" : "-") + money(t.amountMinor, t.currency as Currency) },
    { header: "", cell: (t: Tx) => canTick && <button className="ghost" onClick={() => toggle.mutate({ ids: [t.id], matched: !matched })}>{matched ? "Décocher" : "Pointer"}</button> },
  ];
  return (
    <>
      <Card>
        <div className="form-grid">
          <Field label="Compte bancaire"><select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{accounts.data?.filter((a) => a.type !== "caisse").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Mois du relevé"><input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field>
        </div>
      </Card>
      {data.data && (
        <>
          <Card title={`Non rapprochées (${data.data.unmatched.length})`}><DataTable<Tx> rows={data.data.unmatched} columns={cols(false)} /></Card>
          <Card title={`Rapprochées (${data.data.matched.length})`}><DataTable<Tx> rows={data.data.matched} columns={cols(true)} /></Card>
        </>
      )}
    </>
  );
}

function Periods() {
  const api = useApi();
  const s = useSession();
  const periods = useQuery({ queryKey: useScopedKey("periods"), queryFn: () => api.get<{ id: string; year: number; month: number; closedAt: string | null }[]>("/banking/periods") });
  const invalidate = useInvalidateLedger();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const close = useMutation({ mutationFn: () => { const [year, month] = ym.split("-").map(Number); return api.post("/banking/periods/close", { year, month }); }, onSuccess: invalidate });
  return (
    <Card title="Périodes clôturées">
      {s.can("period.close") && !s.consolidated && (
        <div className="inline-form" style={{ marginBottom: 12 }}>
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          <button onClick={() => window.confirm("Clôturer ce mois ? Aucune écriture ne pourra y être ajoutée.") && close.mutate()}>Clôturer le mois</button>
        </div>
      )}
      <ErrorNote error={close.error} />
      <DataTable rows={(periods.data ?? []).filter((p) => p.closedAt)} columns={[{ header: "Période", cell: (p) => `${String(p.month).padStart(2, "0")}/${p.year}` }, { header: "Clôturée le", cell: (p) => fmtDate(p.closedAt) }]} />
    </Card>
  );
}

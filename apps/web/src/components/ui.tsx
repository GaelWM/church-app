import { useState, type ReactNode } from "react";
import { parseAmount, STATUS_LABELS, type TxStatus } from "@church/shared";

export function StatusBadge({ status }: { status: TxStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function Provisional() {
  return <span className="badge badge-soumise" title="Inclut des écritures non validées">provisoire</span>;
}

/** Accepts "1 250,50" and reports minor units (or null while invalid). */
export function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (raw: string, minor: bigint | null) => void; placeholder?: string }) {
  return (
    <input
      inputMode="decimal" placeholder={placeholder ?? "0,00"} value={value}
      onChange={(e) => {
        const raw = e.target.value;
        let minor: bigint | null = null;
        try { minor = parseAmount(raw); } catch { /* invalid while typing */ }
        onChange(raw, minor);
      }}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="error">{error}</small>}
    </label>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && <header><h3>{title}</h3><div>{actions}</div></header>}
      {children}
    </section>
  );
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; align?: "right" }
export function DataTable<T extends { id?: string }>({ rows, columns, select, empty = "Aucun élément" }: {
  rows: T[]; columns: Column<T>[]; empty?: string;
  select?: { selected: Set<string>; onChange: (s: Set<string>) => void };
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const all = select && rows.every((r) => select.selected.has(r.id!));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {select && <th><input type="checkbox" checked={all} onChange={(e) => select.onChange(new Set(e.target.checked ? rows.map((r) => r.id!) : []))} /></th>}
            {columns.map((c) => <th key={c.header} className={c.align}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {select && <td><input type="checkbox" checked={select.selected.has(r.id!)} onChange={(e) => { const n = new Set(select.selected); e.target.checked ? n.add(r.id!) : n.delete(r.id!); select.onChange(n); }} /></td>}
              {columns.map((c) => <td key={c.header} className={c.align}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="error" role="alert">{(error as Error).message}</p>;
}

/** Prompt for a mandatory reason (rejection, reversal). */
export function ReasonButton({ label, onConfirm, danger }: { label: string; onConfirm: (reason: string) => void; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button className={danger ? "danger" : ""} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="inline-form">
      <input autoFocus placeholder="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button disabled={!reason.trim()} onClick={() => { onConfirm(reason.trim()); setOpen(false); setReason(""); }}>Confirmer</button>
      <button className="ghost" onClick={() => setOpen(false)}>Annuler</button>
    </span>
  );
}

import { useState, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { parseAmount, STATUS_LABELS, type TxStatus } from "@church/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card as ShadCard, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<TxStatus, string> = {
  brouillon: "",
  soumise: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  validee1: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  validee: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejetee: "",
};

export function StatusBadge({ status }: { status: TxStatus }) {
  return (
    <Badge variant={status === "rejetee" ? "destructive" : "secondary"} className={STATUS_STYLE[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function Provisional() {
  return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" title="Inclut des écritures non validées">provisoire</Badge>;
}

/** Accepts "1 250,50" and reports minor units (or null while invalid). */
export function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (raw: string, minor: bigint | null) => void; placeholder?: string }) {
  return (
    <Input
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
    <div className="flex flex-col gap-1.5 [&_[data-slot=native-select-wrapper]]:w-full">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
      {error && <small className="text-destructive">{error}</small>}
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <ShadCard className={cn("mb-4", className)}>
      {(title || actions) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {actions && <CardAction>{actions}</CardAction>}
        </CardHeader>
      )}
      <CardContent className="space-y-3">{children}</CardContent>
    </ShadCard>
  );
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; align?: "right" }
export function DataTable<T extends { id?: string }>({ rows, columns, select, empty = "Aucun élément" }: {
  rows: T[]; columns: Column<T>[]; empty?: string;
  select?: { selected: Set<string>; onChange: (s: Set<string>) => void };
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const all = !!select && rows.every((r) => select.selected.has(r.id!));
  const align = (a?: "right") => (a === "right" ? "text-right tabular-nums" : "");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {select && <TableHead className="w-8"><Checkbox checked={all} onCheckedChange={(v) => select.onChange(new Set(v ? rows.map((r) => r.id!) : []))} aria-label="Tout sélectionner" /></TableHead>}
          {columns.map((c) => <TableHead key={c.header} className={align(c.align)}>{c.header}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.id ?? i}>
            {select && (
              <TableCell>
                <Checkbox
                  checked={select.selected.has(r.id!)} aria-label="Sélectionner"
                  onCheckedChange={(v) => { const n = new Set(select.selected); v ? n.add(r.id!) : n.delete(r.id!); select.onChange(n); }}
                />
              </TableCell>
            )}
            {columns.map((c) => <TableCell key={c.header} className={cn("whitespace-normal", align(c.align))}>{c.cell(r)}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertDescription>{(error as Error).message}</AlertDescription>
    </Alert>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  return <Alert className="mb-3 border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><AlertDescription className="text-inherit">{children}</AlertDescription></Alert>;
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{title}</h2>{children}</div>;
}

/** Prompt for a mandatory reason (rejection, reversal). */
export function ReasonButton({ label, onConfirm, danger }: { label: string; onConfirm: (reason: string) => void; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant={danger ? "destructive" : "default"} onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input autoFocus className="h-7 w-44" placeholder="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" disabled={!reason.trim()} onClick={() => { onConfirm(reason.trim()); setOpen(false); setReason(""); }}>Confirmer</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
    </span>
  );
}

import { useMemo, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronsUpDown, CircleCheck, CircleX, Clock, FilePen, Inbox, Info, Save, ShieldCheck } from "lucide-react";
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { parseAmount, STATUS_LABELS, type Currency, type TxStatus } from "@church/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card as ShadCard, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { moneyParts } from "../core/format";

type Icon = ComponentType<{ className?: string }>;

const STATUS_DOT: Record<TxStatus, string> = {
  brouillon: "bg-muted-foreground/60", soumise: "bg-warning", validee1: "bg-warning", validee: "bg-success", rejetee: "bg-destructive",
};

export const STATUS_ICON: Record<TxStatus, ComponentType<{ className?: string }>> = {
  brouillon: FilePen, soumise: Clock, validee1: ShieldCheck, validee: CircleCheck, rejetee: CircleX,
};

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", className)} />;
}

export function StatusBadge({ status }: { status: TxStatus }) {
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap"><Dot className={STATUS_DOT[status]} />{STATUS_LABELS[status]}</span>;
}

export function Provisional() {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 align-middle text-xs font-medium" title="Inclut des écritures non validées"><Dot className="bg-warning" />provisoire</span>;
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
  // The control is nested inside the <label>, so the label text names it (click-to-focus, screen readers).
  return (
    <div className="flex flex-col gap-1.5 [&_[data-slot=native-select-wrapper]]:w-full">
      <Label className="flex-col items-stretch gap-1.5 text-muted-foreground">
        <span>{label}</span>
        {children}
      </Label>
      {error && <small role="alert" className="text-destructive">{error}</small>}
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: string; /** @deprecated cards no longer show icons */ icon?: Icon; children: ReactNode; actions?: ReactNode; className?: string }) {
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

export interface Column<T> {
  header: string; cell: (row: T) => ReactNode; align?: "right";
  /** Makes the column sortable; return the value to order by (nullish values sort last). */
  sort?: (row: T) => string | number | bigint | null | undefined;
}
export function EmptyState({ title, description }: { icon?: Icon; title: string; description?: string }) {
  return (
    <div className="py-6 text-sm">
      <p className="text-foreground/80">{title}</p>
      {description && <p className="mt-0.5 text-muted-foreground">{description}</p>}
    </div>
  );
}

type SortValue = string | number | bigint | null | undefined;
const compareValues = (x: SortValue, y: SortValue) => {
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // nullish last (ascending)
  if (typeof x === "string" && typeof y === "string") return x.localeCompare(y, "fr", { numeric: true });
  return x < y ? -1 : x > y ? 1 : 0;
};

/** shadcn Data Table: Table primitives driven by TanStack Table (sortable headers, optional pagination), with a skeleton while loading and an empty state. */
export function DataTable<T extends { id?: string }>({ rows, columns, select, loading, empty = "Aucun élément", pageSize }: {
  rows: T[]; columns: Column<T>[]; empty?: string; emptyIcon?: Icon; loading?: boolean;
  /** Paginate at this many rows (the pager only appears when there is more than one page). */
  pageSize?: number;
  select?: { selected: Set<string>; onChange: (s: Set<string>) => void; /** Rows that cannot be selected get a disabled checkbox. */ selectable?: (r: T) => boolean };
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const defs = useMemo<ColumnDef<T>[]>(() => columns.map((c, i) => ({
    id: c.header || `col-${i}`, // action columns have an empty header, and TanStack needs a non-empty id
    header: c.header,
    accessorFn: (r: T) => c.sort?.(r),
    cell: ({ row }) => c.cell(row.original),
    enableSorting: !!c.sort,
    sortingFn: (a, b, id) => compareValues(a.getValue<SortValue>(id), b.getValue<SortValue>(id)),
    sortUndefined: "last",
    meta: { align: c.align },
  })), [columns]);
  const table = useReactTable({
    data: rows, columns: defs, state: { sorting }, onSortingChange: setSorting,
    getRowId: (r, i) => r.id ?? String(i),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    ...(pageSize ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } } : {}),
  });

  if (loading) return <TableSkeleton columns={columns.length + (select ? 1 : 0)} />;
  if (!rows.length) return <EmptyState title={empty} />;
  const pickable = select?.selectable ? rows.filter(select.selectable) : rows;
  const all = !!select && pickable.length > 0 && pickable.every((r) => select.selected.has(r.id!));
  const right = (m: unknown) => (m as { align?: "right" } | undefined)?.align === "right";
  return (
    <>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {select && <TableHead className="w-8"><Checkbox checked={all} onCheckedChange={(v) => select.onChange(new Set(v ? pickable.map((r) => r.id!) : []))} disabled={!pickable.length} aria-label="Tout sélectionner" /></TableHead>}
              {hg.headers.map((h) => {
                const dir = h.column.getIsSorted();
                const r = right(h.column.columnDef.meta);
                return (
                  <TableHead key={h.id} className={cn(r && "text-right")} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}>
                    {h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-[0.08em] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", r && "flex-row-reverse", dir && "text-foreground")}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {select && (
                <TableCell>
                  <Checkbox
                    checked={select.selected.has(row.original.id!)} aria-label="Sélectionner" disabled={select.selectable ? !select.selectable(row.original) : false}
                    onCheckedChange={(v) => { const n = new Set(select.selected); v ? n.add(row.original.id!) : n.delete(row.original.id!); select.onChange(n); }}
                  />
                </TableCell>
              )}
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cn("whitespace-normal", right(cell.column.columnDef.meta) && "text-right tabular-nums")}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageSize && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
          <span>{rows.length} lignes · page {table.getState().pagination.pageIndex + 1} sur {table.getPageCount()}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Précédent</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Suivant</Button>
          </div>
        </div>
      )}
    </>
  );
}

export function TableSkeleton({ columns = 4, rows = 4 }: { columns?: number; rows?: number }) {
  return (
    <div role="status" aria-label="Chargement" className="space-y-2">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className="h-5" />)}
        </div>
      ))}
    </div>
  );
}

/** Full-area spinner for whole-page states (session loading, redirects). */
export function PageSpinner({ label = "Chargement…" }: { label?: string }) {
  return <div className="center"><div className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-5" />{label}</div></div>;
}

/** Headline number with an icon; shows a skeleton while the value loads. */
export function StatCard({ label, value, loading, hint }: { label: string; icon?: Icon; value?: ReactNode; loading?: boolean; hint?: ReactNode }) {
  return (
    <ShadCard>
      <CardHeader>
        <CardTitle className="label-caps font-sans">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-40" /> : <div className="stat">{value}</div>}
        {hint && !loading && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </ShadCard>
  );
}

/** Button with an optional leading icon that turns into a spinner (and disables) while `pending`. */
export function ActionButton({ icon: Icon, pending, children, disabled, ...props }: ComponentProps<typeof Button> & { icon?: Icon; pending?: boolean }) {
  return (
    <Button disabled={disabled || pending} {...props}>
      {pending ? <Spinner /> : Icon && <Icon />}{children}
    </Button>
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

export function Banner({ children, icon: Icon = Info }: { children: ReactNode; icon?: Icon }) {
  return <Alert className="mb-3 border-warning/40 bg-warning/10 text-foreground"><Icon /><AlertDescription className="text-inherit">{children}</AlertDescription></Alert>;
}

export function PageHeader({ title, children }: { title: ReactNode; /** @deprecated page titles no longer show icons */ icon?: Icon; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

/** Ungrouped content block: heading over a hairline, no box. Use instead of Card for dashboard-style pages. */
export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-8", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-3 border-b pb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions && <div className="text-sm text-muted-foreground">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Amount with its currency code set smaller and muted, so the figure leads. */
export function Money({ value, currency, className }: { value: string | bigint | number; currency: Currency; className?: string }) {
  const { amount, code } = moneyParts(value, currency);
  return <span className={cn("whitespace-nowrap tabular-nums", className)}>{amount}<span className="ml-1 text-[0.6em] font-medium tracking-wide text-muted-foreground">{code}</span></span>;
}

/** Dialog shell for forms. The form component goes inside, so it remounts (fresh state) on every open. */
export function ModalForm({ open, onOpenChange, title, description, children, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto sm:max-w-xl", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Two-column responsive field grid used inside modal forms. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 [&>.col-span-full]:sm:col-span-2">{children}</div>;
}

export function FormFooter({ pending, submitLabel = "Enregistrer", onCancel, extra }: { pending?: boolean; submitLabel?: string; onCancel: () => void; extra?: ReactNode }) {
  return (
    <DialogFooter className="mt-4">
      <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>
      {extra}
      <Button type="submit" disabled={pending}>{pending ? <Spinner /> : <Save />}{submitLabel}</Button>
    </DialogFooter>
  );
}

const reasonSchema = z.object({ reason: z.string().trim().min(1, "Le motif est obligatoire") });

function ReasonForm({ label, confirmLabel, destructive, onConfirm, onClose }: { label: string; confirmLabel: string; destructive?: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof reasonSchema>>({ resolver: zodResolver(reasonSchema) });
  return (
    <form onSubmit={handleSubmit((v) => { onConfirm(v.reason); onClose(); })} className="space-y-3">
      <Field label={label} error={errors.reason?.message}><Input autoFocus {...register("reason")} /></Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
        <Button type="submit" variant={destructive ? "destructive" : "default"}>{destructive ? <CircleX /> : <Check />}{confirmLabel}</Button>
      </DialogFooter>
    </form>
  );
}

/** Modal asking for a mandatory reason (rejection, reversal). */
export function ReasonDialog({ open, onOpenChange, title, label = "Motif (obligatoire)", confirmLabel = "Confirmer", destructive, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; label?: string; confirmLabel?: string; destructive?: boolean; onConfirm: (reason: string) => void;
}) {
  return (
    <ModalForm open={open} onOpenChange={onOpenChange} title={title} className="sm:max-w-md">
      <ReasonForm label={label} confirmLabel={confirmLabel} destructive={destructive} onConfirm={onConfirm} onClose={() => onOpenChange(false)} />
    </ModalForm>
  );
}

/** Button that opens a reason dialog. */
export function ReasonButton({ label, onConfirm, danger, icon: Icon }: { label: string; onConfirm: (reason: string) => void; danger?: boolean; icon?: Icon }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={danger ? "destructive" : "default"} onClick={() => setOpen(true)}>{Icon && <Icon />}{label}</Button>
      <ReasonDialog open={open} onOpenChange={setOpen} title={label} destructive={danger} onConfirm={onConfirm} />
    </>
  );
}

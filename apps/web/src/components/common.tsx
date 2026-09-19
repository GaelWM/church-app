import { useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { AlertCircle, Check, CircleCheck, CircleX, Clock, FilePen, Inbox, Info, Save, ShieldCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { parseAmount, STATUS_LABELS, type TxStatus } from "@church/shared";
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

type Icon = ComponentType<{ className?: string }>;

const STATUS_STYLE: Record<TxStatus, string> = {
  brouillon: "",
  soumise: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  validee1: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  validee: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejetee: "",
};

export const STATUS_ICON: Record<TxStatus, ComponentType<{ className?: string }>> = {
  brouillon: FilePen, soumise: Clock, validee1: ShieldCheck, validee: CircleCheck, rejetee: CircleX,
};

export function StatusBadge({ status }: { status: TxStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={status === "rejetee" ? "destructive" : "secondary"} className={STATUS_STYLE[status]}>
      <Icon />{STATUS_LABELS[status]}
    </Badge>
  );
}

export function Provisional() {
  return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" title="Inclut des écritures non validées"><Clock />provisoire</Badge>;
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

export function Card({ title, icon: Icon, children, actions, className }: { title?: string; icon?: Icon; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <ShadCard className={cn("mb-4", className)}>
      {(title || actions) && (
        <CardHeader>
          {title && <CardTitle className="flex items-center gap-2">{Icon && <Icon className="size-4 text-muted-foreground" />}{title}</CardTitle>}
          {actions && <CardAction>{actions}</CardAction>}
        </CardHeader>
      )}
      <CardContent className="space-y-3">{children}</CardContent>
    </ShadCard>
  );
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; align?: "right" }
export function EmptyState({ icon: Icon = Inbox, title, description }: { icon?: Icon; title: string; description?: string }) {
  return (
    <Empty className="border border-dashed p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

/** Table with a skeleton while loading and an empty state when there is nothing to show. */
export function DataTable<T extends { id?: string }>({ rows, columns, select, loading, empty = "Aucun élément", emptyIcon }: {
  rows: T[]; columns: Column<T>[]; empty?: string; emptyIcon?: Icon; loading?: boolean;
  select?: { selected: Set<string>; onChange: (s: Set<string>) => void };
}) {
  if (loading) return <TableSkeleton columns={columns.length + (select ? 1 : 0)} />;
  if (!rows.length) return <EmptyState icon={emptyIcon} title={empty} />;
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
export function StatCard({ label, icon: Icon, value, loading, hint }: { label: string; icon: Icon; value?: ReactNode; loading?: boolean; hint?: ReactNode }) {
  return (
    <ShadCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="size-4" />{label}</CardTitle>
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
  return <Alert className="mb-3 border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><Icon /><AlertDescription className="text-inherit">{children}</AlertDescription></Alert>;
}

export function PageHeader({ title, icon: Icon, children }: { title: ReactNode; icon?: Icon; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xl font-semibold">{Icon && <Icon className="size-5 text-muted-foreground" />}{title}</h2>
      {children}
    </div>
  );
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

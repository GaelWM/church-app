import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TAB_LABELS } from "../../app/routes";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { amountField } from "../../core/forms";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAmount, type Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money, today } from "../../core/format";
import { useAccounts, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const OPS = [
  ["versement", "Versement (caisse vers banque)"], ["retrait", "Retrait (banque vers caisse)"], ["virement", "Virement entre comptes"],
  ["change", "Opération de change"], ["frais", "Frais bancaires et commissions"], ["interets", "Intérêts créditeurs"],
] as const;

const TAB_KEYS = ["operations", "rapprochement", "periodes"] as const;
type BankTab = (typeof TAB_KEYS)[number];

export function BanquesPage() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as BankTab | null;
  const tab: BankTab = requested && TAB_KEYS.includes(requested) ? requested : "operations";
  // Keep the URL (and so the breadcrumb) in step with the tab actually shown, including the default.
  useEffect(() => { if (params.get("tab") !== tab) setParams({ tab }, { replace: true }); }, [tab, params]);
  return (
    <>
      <PageHeader title="Banques" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-4">
        <TabsList>
          {TAB_KEYS.map((t) => <TabsTrigger key={t} value={t}>{TAB_LABELS["/banques"]![t]}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === "operations" && <Operations canEnter={s.can("transaction.create") && !s.consolidated} />}
      {tab === "rapprochement" && <Reconciliation />}
      {tab === "periodes" && <Periods />}
    </>
  );
}

const opSchema = z.object({
  type: z.enum(["versement", "retrait", "virement", "change", "frais", "interets"]),
  date: z.string().min(1, "Date requise"),
  accountId: z.string().optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  amount: amountField,
  rate: z.string().optional(),
  description: z.string().optional(),
}).superRefine((v, ctx) => {
  const need = (path: "accountId" | "fromAccountId" | "toAccountId" | "rate", msg: string) => { if (!v[path]) ctx.addIssue({ code: "custom", path: [path], message: msg }); };
  if (v.type === "frais" || v.type === "interets") need("accountId", "Compte requis");
  else { need("fromAccountId", "Compte source requis"); need("toAccountId", "Compte destination requis"); }
  if (v.type === "change") {
    if (!v.rate || !/^\d+([.,]\d{1,4})?$/.test(v.rate)) ctx.addIssue({ code: "custom", path: ["rate"], message: "Taux invalide" });
  }
});
type OpValues = z.infer<typeof opSchema>;

function Operations({ canEnter }: { canEnter: boolean }) {
  const api = useApi();
  const accounts = useAccounts();
  const [open, setOpen] = useState(false);
  const rows = useQuery({ queryKey: useScopedKey("bank-tx"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "transfert,change" }) });
  return (
    <>
      {canEnter && <div className="mb-3"><Button onClick={() => setOpen(true)}><Plus /> Nouvelle opération</Button></div>}
      <Card title="Virements et changes">
        <DataTable<Tx> rows={rows.data ?? []} columns={[
          { header: "Réf.", cell: (t) => t.reference }, { header: "Date", cell: (t) => fmtDate(t.date) },
          { header: "Type", cell: (t) => t.kind }, { header: "Compte", cell: (t) => accounts.data?.find((a) => a.id === t.accountId)?.name ?? "" },
          { header: "Sens", cell: (t) => (t.direction === "in" ? "Entrée" : "Sortie") },
          { header: "Montant", align: "right", cell: (t) => money(t.amountMinor, t.currency as Currency) }, { header: "Statut", cell: (t) => <StatusBadge status={t.status} /> },
        ]} />
        <p className="muted">Les écritures se soumettent et se valident depuis « À valider » (les deux lignes d'un transfert ensemble).</p>
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvelle opération bancaire" description="Enregistrée en brouillon; les deux lignes d'un transfert sont validées ensemble.">
        <OperationForm onClose={() => setOpen(false)} />
      </ModalForm>
    </>
  );
}

function OperationForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const accounts = useAccounts();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<OpValues>({
    resolver: zodResolver(opSchema), defaultValues: { type: "versement", date: today(), amount: "" },
  });
  const type = watch("type");
  const single = type === "frais" || type === "interets";
  const create = useMutation({
    mutationFn: (v: OpValues) => api.post("/banking/operations", {
      type: v.type, date: v.date, description: v.description || undefined, amountMinor: parseAmount(v.amount).toString(),
      ...(single ? { accountId: v.accountId } : { fromAccountId: v.fromAccountId, toAccountId: v.toAccountId }),
      ...(v.type === "change" ? { actualRateCdfPerUsd: (v.rate ?? "").replace(",", ".") } : {}),
    }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  const opts = <>{accounts.data?.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</>;
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Opération"><NativeSelect {...register("type")}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
        <Field label="Date" error={errors.date?.message}><Input type="date" {...register("date")} /></Field>
        {single ? (
          <Field label="Compte" error={errors.accountId?.message}><NativeSelect {...register("accountId")}><option value="">—</option>{opts}</NativeSelect></Field>
        ) : (
          <>
            <Field label="De" error={errors.fromAccountId?.message}><NativeSelect {...register("fromAccountId")}><option value="">—</option>{opts}</NativeSelect></Field>
            <Field label="Vers" error={errors.toAccountId?.message}><NativeSelect {...register("toAccountId")}><option value="">—</option>{opts}</NativeSelect></Field>
          </>
        )}
        <Field label="Montant (devise du compte source)" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        {type === "change" && <Field label="Taux obtenu (1 USD = X CDF)" error={errors.rate?.message}><Input inputMode="decimal" {...register("rate")} /></Field>}
        <div className="col-span-full"><Field label="Description"><Input {...register("description")} /></Field></div>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={create.error} /></div>
      <FormFooter pending={create.isPending} onCancel={onClose} />
    </form>
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
    { header: "", cell: (t: Tx) => canTick && <Button size="sm" variant="outline" onClick={() => toggle.mutate({ ids: [t.id], matched: !matched })}>{matched ? "Décocher" : "Pointer"}</Button> },
  ];
  return (
    <>
      <Card>
        <div className="form-grid">
          <Field label="Compte bancaire"><NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{accounts.data?.filter((a) => a.type !== "caisse").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>
          <Field label="Mois du relevé"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field>
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

const periodSchema = z.object({ ym: z.string().regex(/^\d{4}-\d{2}$/, "Mois requis") });

function Periods() {
  const api = useApi();
  const s = useSession();
  const periods = useQuery({ queryKey: useScopedKey("periods"), queryFn: () => api.get<{ id: string; year: number; month: number; closedAt: string | null }[]>("/banking/periods") });
  const [open, setOpen] = useState(false);
  return (
    <>
      {s.can("period.close") && !s.consolidated && <div className="mb-3"><Button onClick={() => setOpen(true)}>Clôturer un mois</Button></div>}
      <Card title="Périodes clôturées">
        <DataTable rows={(periods.data ?? []).filter((p) => p.closedAt)} columns={[{ header: "Période", cell: (p) => `${String(p.month).padStart(2, "0")}/${p.year}` }, { header: "Clôturée le", cell: (p) => fmtDate(p.closedAt) }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Clôturer un mois" description="Après la clôture, aucune écriture ne peut être ajoutée à ce mois. Toutes les écritures du mois doivent être validées ou rejetées.">
        <ClosePeriodForm onClose={() => setOpen(false)} />
      </ModalForm>
    </>
  );
}

function ClosePeriodForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const now = new Date();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof periodSchema>>({
    resolver: zodResolver(periodSchema), defaultValues: { ym: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` },
  });
  const close = useMutation({
    mutationFn: (v: z.infer<typeof periodSchema>) => { const [year, month] = v.ym.split("-").map(Number); return api.post("/banking/periods/close", { year, month }); },
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => close.mutate(v))} noValidate>
      <Field label="Mois à clôturer" error={errors.ym?.message}><Input type="month" {...register("ym")} /></Field>
      <div className="mt-3"><ErrorNote error={close.error} /></div>
      <FormFooter pending={close.isPending} onCancel={onClose} submitLabel="Clôturer" />
    </form>
  );
}

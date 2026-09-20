import { useState } from "react";
import { FormDate, FormSelect, OptionSelect, dateLimits } from "@/components/form-controls";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, HandCoins, Handshake, History, Paperclip, Printer, ReceiptText, Plus } from "lucide-react";
import { CURRENCIES, ENGAGEMENT_TYPES, ENGAGEMENT_TYPE_LABELS, parseAmount, type Currency, type EngagementType } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader } from "@/components/common";
import { useApi } from "../../core/api";
import { amountField, requiredSelect } from "../../core/forms";
import { fmtDate, money } from "../../core/format";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { exportTable, type ExportFormat } from "@/lib/export-table";

interface Pledge { id: string; memberId?: string | null; donorName?: string | null; categoryId: string; currency: Currency; amountMinor: string; dueDate?: string | null; type: EngagementType; beneficiary?: string | null; releasedMinor: string; remainingMinor: string }
interface Commitment { id: string; categoryId: string; payee: string; currency: Currency; amountMinor: string; dueDate?: string | null; status: string; type: EngagementType; releasedMinor: string; remainingMinor: string }
interface SummaryRow { type: EngagementType; currency: Currency; engagedMinor: string; releasedMinor: string; remainingMinor: string }
interface Release { id: string; date: string; currency: Currency; amountMinor: string; accountId?: string | null; transactionId?: string | null; note?: string | null; filename?: string | null }
type Target = { kind: "pledges" | "commitments"; id: string; label: string; currency: Currency; engaged: string } | null;
interface Member { id: string; fullName: string; phone?: string | null }
type Dialog = "pledge" | "commitment" | null;

const pct = (released: string, engaged: string) => (BigInt(engaged) > 0n ? Math.min(100, Number((BigInt(released) * 100n) / BigInt(engaged))) : 0);
function Progress({ released, engaged }: { released: string; engaged: string }) {
  const v = pct(released, engaged);
  return <div className="flex items-center gap-2" title={`${v}%`}><div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${v}%` }} /></div><span className="text-xs text-muted-foreground">{v}%</span></div>;
}
function ExportButtons({ onExport }: { onExport: (f: ExportFormat) => void }) {
  return <span className="flex gap-1"><Button size="sm" variant="outline" onClick={() => onExport("xlsx")}><FileSpreadsheet />Excel</Button><Button size="sm" variant="outline" onClick={() => onExport("pdf")}><FileDown />PDF</Button><Button size="sm" variant="outline" onClick={() => onExport("print")}><Printer />Imprimer</Button></span>;
}

export function EngagementsPage() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  const recettes = useCategories("recette");
  const [dialog, setDialog] = useState<Dialog>(null);
  const pledges = useQuery({ queryKey: useScopedKey("pledges"), queryFn: () => api.get<Pledge[]>("/engagements/pledges") });
  const commitments = useQuery({ queryKey: useScopedKey("commitments"), queryFn: () => api.get<Commitment[]>("/engagements/commitments") });
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<Member[]>("/engagements/members") });
  const txs = useQuery({ queryKey: useScopedKey("tx", "recette"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "recette" }) });
  const depenseTx = useQuery({ queryKey: useScopedKey("tx", "depense", "validee"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "depense", status: "validee" }) });
  const depenses = useCategories("depense");
  const summary = useQuery({ queryKey: useScopedKey("engagements-summary"), queryFn: () => api.get<{ pledges: SummaryRow[]; commitments: SummaryRow[] }>("/engagements/summary") });
  const [target, setTarget] = useState<Target>(null);
  const canExport = s.can("report.export");
  const close = () => setDialog(null);
  const typeLabel = (t: string) => ENGAGEMENT_TYPE_LABELS[t as EngagementType] ?? t;
  const donor = (x: Pledge) => x.donorName ?? members.data?.find((mm) => mm.id === x.memberId)?.fullName ?? "";
  const exportPledges = (f: ExportFormat) => exportTable(f, {
    title: "Promesses de dons", columns: [{ header: "Donateur", key: "d" }, { header: "Type", key: "t" }, { header: "Bénéficiaire", key: "b" }, { header: "Échéance", key: "e" }, { header: "Engagé", key: "p", align: "right" }, { header: "Libéré", key: "l", align: "right" }, { header: "Solde", key: "s", align: "right" }],
    rows: (pledges.data ?? []).map((x) => ({ d: donor(x), t: typeLabel(x.type), b: x.beneficiary ?? "", e: fmtDate(x.dueDate), p: money(x.amountMinor, x.currency), l: money(x.releasedMinor, x.currency), s: money(x.remainingMinor, x.currency) })),
  });
  const exportCommitments = (f: ExportFormat) => exportTable(f, {
    title: "Engagements de dépenses", columns: [{ header: "Bénéficiaire", key: "b" }, { header: "Type", key: "t" }, { header: "Échéance", key: "e" }, { header: "Engagé", key: "p", align: "right" }, { header: "Libéré", key: "l", align: "right" }, { header: "Solde", key: "s", align: "right" }, { header: "Statut", key: "st" }],
    rows: (commitments.data ?? []).map((x) => ({ b: x.payee, t: typeLabel(x.type), e: fmtDate(x.dueDate), p: money(x.amountMinor, x.currency), l: money(x.releasedMinor, x.currency), s: money(x.remainingMinor, x.currency), st: x.status === "paid" ? "Payé" : x.status === "cancelled" ? "Annulé" : "Ouvert" })),
  });

  return (
    <>
      <PageHeader title="Engagements" icon={Handshake} />
      <Card title="Synthèse par type d'engagement" icon={Handshake}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ENGAGEMENT_TYPES.map((t) => {
            const rows = [...(summary.data?.pledges ?? []).map((r) => ({ ...r, side: "Promesses" })), ...(summary.data?.commitments ?? []).map((r) => ({ ...r, side: "Dépenses" }))].filter((r) => r.type === t);
            return (
              <div key={t} className="rounded-lg border p-3 text-sm">
                <div className="mb-2 font-medium">{ENGAGEMENT_TYPE_LABELS[t]}</div>
                {rows.length === 0 && <div className="text-muted-foreground">Aucun engagement</div>}
                {rows.map((r) => (
                  <div key={r.side + r.currency} className="mb-2 space-y-0.5">
                    <div className="text-xs text-muted-foreground">{r.side} · {r.currency}</div>
                    <div className="flex justify-between"><span>Engagé</span><span>{money(r.engagedMinor, r.currency)}</span></div>
                    <div className="flex justify-between"><span>Libéré</span><span>{money(r.releasedMinor, r.currency)}</span></div>
                    <div className="flex justify-between"><span>Non libéré</span><span>{money(r.remainingMinor, r.currency)}</span></div>
                    <Progress released={r.releasedMinor} engaged={r.engagedMinor} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Promesses de dons" icon={HandCoins} actions={<span className="flex gap-2">{canExport && <ExportButtons onExport={exportPledges} />}{canEnter && <Button size="sm" onClick={() => setDialog("pledge")}><Plus /> Promesse</Button>}</span>}>
        <DataTable<Pledge> rows={pledges.data ?? []} loading={pledges.isLoading} emptyIcon={HandCoins} empty="Aucune promesse de don" columns={[
          { header: "Donateur", cell: donor }, { header: "Type", cell: (x) => typeLabel(x.type) }, { header: "Bénéficiaire", cell: (x) => x.beneficiary ?? "" },
          { header: "Catégorie", cell: (x) => recettes.data?.find((r) => r.id === x.categoryId)?.name ?? "" },
          { header: "Échéance", cell: (x) => fmtDate(x.dueDate) },
          { header: "Promis", align: "right", cell: (x) => money(x.amountMinor, x.currency) },
          { header: "Libéré", align: "right", cell: (x) => money(x.releasedMinor, x.currency) },
          { header: "Solde", align: "right", cell: (x) => money(x.remainingMinor, x.currency) },
          { header: "Avancement", cell: (x) => <Progress released={x.releasedMinor} engaged={x.amountMinor} /> },
          { header: "", cell: (x) => <Button size="sm" variant="outline" onClick={() => setTarget({ kind: "pledges", id: x.id, label: donor(x) || "Promesse", currency: x.currency, engaged: x.amountMinor })}><History />Libérations</Button> },
        ]} />
        <p className="muted">Une recette validée liée à la promesse (champ « Promesse liée » dans Recettes) crée automatiquement une libération.</p>
      </Card>

      <Card title="Engagements de dépenses" icon={ReceiptText} actions={<span className="flex gap-2">{canExport && <ExportButtons onExport={exportCommitments} />}{canEnter && <Button size="sm" onClick={() => setDialog("commitment")}><Plus /> Engagement</Button>}</span>}>
        <DataTable<Commitment> rows={commitments.data ?? []} loading={commitments.isLoading} emptyIcon={ReceiptText} empty="Aucun engagement de dépense" columns={[
          { header: "Bénéficiaire", cell: (x) => x.payee }, { header: "Type", cell: (x) => typeLabel(x.type) },
          { header: "Catégorie", cell: (x) => depenses.data?.find((d) => d.id === x.categoryId)?.name ?? "" },
          { header: "Échéance", cell: (x) => fmtDate(x.dueDate) },
          { header: "Engagé", align: "right", cell: (x) => money(x.amountMinor, x.currency) },
          { header: "Libéré", align: "right", cell: (x) => money(x.releasedMinor, x.currency) },
          { header: "Solde", align: "right", cell: (x) => money(x.remainingMinor, x.currency) },
          { header: "Avancement", cell: (x) => <Progress released={x.releasedMinor} engaged={x.amountMinor} /> },
          { header: "Statut", cell: (x) => (x.status === "paid" ? "Payé" : x.status === "cancelled" ? "Annulé" : "Ouvert") },
          { header: "", cell: (x) => <Button size="sm" variant="outline" onClick={() => setTarget({ kind: "commitments", id: x.id, label: x.payee, currency: x.currency, engaged: x.amountMinor })}><History />Libérations</Button> },
        ]} />
      </Card>

      <ModalForm open={!!target} onOpenChange={(o) => !o && setTarget(null)} title={target ? `Libérations — ${target.label}` : ""} className="sm:max-w-2xl">{target && <ReleasesDialog target={target} canEnter={canEnter} txs={target.kind === "pledges" ? txs.data ?? [] : depenseTx.data ?? []} />}</ModalForm>
      <ModalForm open={dialog === "pledge"} onOpenChange={(o) => !o && close()} title="Nouvelle promesse de don"><PledgeForm onClose={close} /></ModalForm>
      <ModalForm open={dialog === "commitment"} onOpenChange={(o) => !o && close()} title="Nouvel engagement de dépense"><CommitmentForm onClose={close} /></ModalForm>
    </>
  );
}

const currency = z.enum(CURRENCIES);
const typeOptions = ENGAGEMENT_TYPES.map((t) => ({ value: t, label: ENGAGEMENT_TYPE_LABELS[t] }));

const pledgeSchema = z.object({
  memberId: z.string().optional(), donorName: z.string().optional(), categoryId: requiredSelect("Catégorie requise"),
  currency, amount: amountField, dueDate: z.string().optional(), type: z.enum(ENGAGEMENT_TYPES), beneficiary: z.string().optional(),
}).refine((v) => v.memberId || v.donorName?.trim(), { path: ["donorName"], message: "Choisissez un membre ou saisissez un nom" });

function PledgeForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const recettes = useCategories("recette");
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<Member[]>("/engagements/members") });
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof pledgeSchema>>({ resolver: zodResolver(pledgeSchema), defaultValues: { currency: "CDF", categoryId: "", amount: "", type: "autre" } });
  const add = useMutation({
    mutationFn: (v: z.infer<typeof pledgeSchema>) => api.post("/engagements/pledges", { donorName: v.donorName || undefined, memberId: v.memberId || undefined, categoryId: v.categoryId, currency: v.currency, amountMinor: parseAmount(v.amount).toString(), dueDate: v.dueDate || undefined, type: v.type, beneficiary: v.beneficiary?.trim() || undefined }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Type d'engagement"><FormSelect control={control} name="type" options={typeOptions} /></Field>
        <Field label="Bénéficiaire / projet"><Input {...register("beneficiary")} /></Field>
        <Field label="Membre"><FormSelect control={control} name="memberId" options={[{ value: "", label: "—" }, ...(members.data ?? []).map((x) => ({ value: x.id, label: x.fullName }))]} /></Field>
        <Field label="ou nom du donateur / partenaire" error={errors.donorName?.message}><Input {...register("donorName")} /></Field>
        <Field label="Catégorie" error={errors.categoryId?.message}><FormSelect control={control} name="categoryId" options={[{ value: "", label: "—" }, ...(recettes.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} /></Field>
        <Field label="Devise"><FormSelect control={control} name="currency" options={[...(CURRENCIES ?? []).map((c) => ({ value: c, label: c }))]} /></Field>
        <Field label="Montant promis" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        <Field label="Échéance"><FormDate control={control} name="dueDate" {...dateLimits.due()} /></Field>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={add.error} /></div>
      <FormFooter pending={add.isPending} onCancel={onClose} />
    </form>
  );
}

const commitmentSchema = z.object({ type: z.enum(ENGAGEMENT_TYPES), payee: z.string().trim().min(1, "Bénéficiaire requis"), categoryId: requiredSelect("Catégorie requise"), currency, amount: amountField, dueDate: z.string().optional() });

function CommitmentForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const depenses = useCategories("depense");
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof commitmentSchema>>({ resolver: zodResolver(commitmentSchema), defaultValues: { currency: "CDF", categoryId: "", amount: "", payee: "", type: "autre" } });
  const add = useMutation({
    mutationFn: (v: z.infer<typeof commitmentSchema>) => api.post("/engagements/commitments", { payee: v.payee, categoryId: v.categoryId, currency: v.currency, amountMinor: parseAmount(v.amount).toString(), dueDate: v.dueDate || undefined, type: v.type }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Type d'engagement"><FormSelect control={control} name="type" options={typeOptions} /></Field>
        <Field label="Bénéficiaire" error={errors.payee?.message}><Input {...register("payee")} /></Field>
        <Field label="Catégorie" error={errors.categoryId?.message}><FormSelect control={control} name="categoryId" options={[{ value: "", label: "—" }, ...(depenses.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} /></Field>
        <Field label="Devise"><FormSelect control={control} name="currency" options={[...(CURRENCIES ?? []).map((c) => ({ value: c, label: c }))]} /></Field>
        <Field label="Montant" error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        <Field label="Échéance"><FormDate control={control} name="dueDate" {...dateLimits.due()} /></Field>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={add.error} /></div>
      <FormFooter pending={add.isPending} onCancel={onClose} />
    </form>
  );
}


const releaseSchema = z.object({ date: z.string().min(1, "Date requise"), amount: amountField, accountId: z.string().optional(), transactionId: z.string().optional(), note: z.string().optional() });

function ReleasesDialog({ target, canEnter, txs }: { target: NonNullable<Target>; canEnter: boolean; txs: Tx[] }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const accounts = useAccounts();
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const rels = useQuery({ queryKey: useScopedKey("releases", target.kind, target.id), queryFn: () => api.get<Release[]>(`/engagements/${target.kind}/${target.id}/releases`) });
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof releaseSchema>>({ resolver: zodResolver(releaseSchema), defaultValues: { date: new Date().toISOString().slice(0, 10), amount: "", accountId: "", transactionId: "", note: "" } });
  const add = useMutation({
    mutationFn: async (v: z.infer<typeof releaseSchema>) => {
      const r = await api.post<Release>(`/engagements/${target.kind}/${target.id}/releases`, { date: v.date, amountMinor: parseAmount(v.amount).toString(), accountId: v.accountId || undefined, transactionId: v.transactionId || undefined, note: v.note?.trim() || undefined });
      if (file) await api.upload(`/engagements/releases/${r.id}/file`, file);
      return r;
    },
    onSuccess: () => { invalidate(); reset(); setFile(null); setAdding(false); },
  });
  const open = async (id: string) => window.open(await api.fileUrl(`/engagements/releases/${id}/file`), "_blank");
  const list = rels.data ?? [];
  const released = list.reduce((a, r) => a + BigInt(r.amountMinor), 0n);
  const accName = (id?: string | null) => accounts.data?.find((a) => a.id === id)?.name ?? "";
  const txRef = (id?: string | null) => txs.find((t) => t.id === id)?.reference ?? (id ? id.slice(0, 8) : "");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div><div className="text-xs text-muted-foreground">Engagé</div>{money(target.engaged, target.currency)}</div>
        <div><div className="text-xs text-muted-foreground">Libéré</div>{money(released, target.currency)}</div>
        <div><div className="text-xs text-muted-foreground">Solde</div>{money(BigInt(target.engaged) - released, target.currency)}</div>
      </div>
      <Progress released={released.toString()} engaged={target.engaged} />
      <DataTable<Release> rows={list} loading={rels.isLoading} empty="Aucune libération" columns={[
        { header: "Date", cell: (r) => fmtDate(r.date) }, { header: "Montant", align: "right", cell: (r) => money(r.amountMinor, r.currency) },
        { header: "Compte", cell: (r) => accName(r.accountId) }, { header: "Écriture", cell: (r) => txRef(r.transactionId) }, { header: "Note", cell: (r) => r.note ?? "" },
        { header: "", cell: (r) => r.filename && <Button size="sm" variant="ghost" onClick={() => open(r.id)}><Paperclip />{r.filename}</Button> },
      ]} />
      {canEnter && !adding && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Ajouter une libération</Button>}
      {canEnter && adding && (
        <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate className="space-y-3 rounded-lg border p-3">
          <FormGrid>
            <Field label="Date" error={errors.date?.message}><FormDate control={control} name="date" {...dateLimits.past()} /></Field>
            <Field label={`Montant (${target.currency})`} error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
            <Field label="Compte"><FormSelect control={control} name="accountId" options={[{ value: "", label: "—" }, ...(accounts.data ?? []).filter((a) => a.currency === target.currency).map((a) => ({ value: a.id, label: a.name }))]} /></Field>
            <Field label="Lien vers une écriture"><FormSelect control={control} name="transactionId" options={[{ value: "", label: "—" }, ...txs.filter((t) => t.currency === target.currency).map((t) => ({ value: t.id, label: `${t.reference} · ${money(t.amountMinor, t.currency)}` }))]} /></Field>
            <div className="col-span-full"><Field label="Note"><Input {...register("note")} /></Field></div>
            <div className="col-span-full"><Field label="Justificatif (JPEG, PNG, WebP, PDF — 8 Mo max)"><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field></div>
          </FormGrid>
          <ErrorNote error={add.error} />
          <FormFooter pending={add.isPending} onCancel={() => setAdding(false)} />
        </form>
      )}
    </div>
  );
}

import { useState } from "react";
import { FormDate, FormSelect, OptionSelect, dateLimits } from "@/components/form-controls";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, HandCoins, Handshake, ReceiptText, Users, Plus } from "lucide-react";
import { CURRENCIES, parseAmount, type Currency } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader } from "@/components/common";
import { useApi } from "../../core/api";
import { amountField, requiredSelect } from "../../core/forms";
import { fmtDate, money } from "../../core/format";
import { useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { exportPdf } from "../journal/export";

interface Pledge { id: string; memberId?: string | null; donorName?: string | null; categoryId: string; currency: Currency; amountMinor: string; dueDate?: string | null }
interface Commitment { id: string; categoryId: string; payee: string; currency: Currency; amountMinor: string; dueDate?: string | null; status: string }
interface Member { id: string; fullName: string; phone?: string | null }
type Dialog = "pledge" | "commitment" | "member" | null;

export function EngagementsPage() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  const recettes = useCategories("recette");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const pledges = useQuery({ queryKey: useScopedKey("pledges"), queryFn: () => api.get<Pledge[]>("/engagements/pledges") });
  const commitments = useQuery({ queryKey: useScopedKey("commitments"), queryFn: () => api.get<Commitment[]>("/engagements/commitments") });
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<Member[]>("/engagements/members") });
  const txs = useQuery({ queryKey: useScopedKey("tx", "recette"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "recette" }) });
  const depenseTx = useQuery({ queryKey: useScopedKey("tx", "depense", "validee"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "depense", status: "validee" }) });
  const depenses = useCategories("depense");
  const markPaid = useMutation({ mutationFn: (v: { id: string; transactionId: string }) => api.post(`/engagements/commitments/${v.id}/paid`, { transactionId: v.transactionId }), onSuccess: invalidate });
  const received = (id: string) => (txs.data ?? []).filter((t) => t.pledgeId === id && t.status === "validee").reduce((a, t) => a + BigInt(t.amountMinor), 0n);
  const close = () => setDialog(null);

  const statement = (member: Member) => {
    const rows = (txs.data ?? []).filter((t) => t.memberId === member.id && t.status === "validee" && t.date.startsWith(year));
    exportPdf(`Relevé de dons ${year} — ${member.fullName}`, ["Date", "Référence", "Catégorie", "Montant"],
      rows.map((t) => [fmtDate(t.date), t.reference, recettes.data?.find((x) => x.id === t.categoryId)?.name ?? "", money(t.amountMinor, t.currency)]));
  };

  return (
    <>
      <PageHeader title="Engagements" icon={Handshake} />
      <Card title="Promesses de dons" icon={HandCoins} actions={canEnter && <Button size="sm" onClick={() => setDialog("pledge")}><Plus /> Promesse</Button>}>
        <DataTable<Pledge> rows={pledges.data ?? []} loading={pledges.isLoading} emptyIcon={HandCoins} empty="Aucune promesse de don" columns={[
          { header: "Donateur", cell: (x) => x.donorName ?? members.data?.find((mm) => mm.id === x.memberId)?.fullName ?? "" },
          { header: "Catégorie", cell: (x) => recettes.data?.find((r) => r.id === x.categoryId)?.name ?? "" },
          { header: "Échéance", cell: (x) => fmtDate(x.dueDate) },
          { header: "Promis", align: "right", cell: (x) => money(x.amountMinor, x.currency) },
          { header: "Reçu", align: "right", cell: (x) => money(received(x.id), x.currency) },
          { header: "Reste", align: "right", cell: (x) => money(BigInt(x.amountMinor) - received(x.id), x.currency) },
        ]} />
        <p className="muted">Chaque paiement est une recette normale liée à la promesse (champ « Promesse liée » dans Recettes).</p>
      </Card>

      <Card title="Engagements de dépenses" icon={ReceiptText} actions={canEnter && <Button size="sm" onClick={() => setDialog("commitment")}><Plus /> Engagement</Button>}>
        <ErrorNote error={markPaid.error} />
        <DataTable<Commitment> rows={commitments.data ?? []} loading={commitments.isLoading} emptyIcon={ReceiptText} empty="Aucun engagement de dépense" columns={[
          { header: "Bénéficiaire", cell: (x) => x.payee }, { header: "Catégorie", cell: (x) => depenses.data?.find((d) => d.id === x.categoryId)?.name ?? "" },
          { header: "Échéance", cell: (x) => fmtDate(x.dueDate) },
          { header: "Montant", align: "right", cell: (x) => money(x.amountMinor, x.currency) }, { header: "Statut", cell: (x) => (x.status === "paid" ? "Payé" : "Ouvert") },
          { header: "", cell: (x) => canEnter && x.status === "open" && (
            <OptionSelect size="sm" className="w-auto min-w-48" value="" placeholder="Lier à la dépense payée…" aria-label="Lier à la dépense payée" onValueChange={(v) => v && markPaid.mutate({ id: x.id, transactionId: v })} options={(depenseTx.data ?? []).filter((t) => t.currency === x.currency).map((t) => ({ value: t.id, label: `${t.reference} · ${money(t.amountMinor, t.currency)}` }))} />) },
        ]} />
      </Card>

      <Card title="Membres (dîme et relevés de dons)" icon={Users} actions={
        <span className="flex items-center gap-2">
          <Input className="h-7 w-20" aria-label="Année du relevé" value={year} onChange={(e) => setYear(e.target.value)} />
          {canEnter && <Button size="sm" onClick={() => setDialog("member")}><Plus /> Membre</Button>}
        </span>
      }>
        <DataTable<Member> rows={members.data ?? []} loading={members.isLoading} emptyIcon={Users} empty="Aucun membre enregistré" columns={[
          { header: "Nom", cell: (x) => x.fullName }, { header: "Téléphone", cell: (x) => x.phone ?? "" },
          { header: "", cell: (x) => s.can("report.export") && <Button size="sm" variant="outline" onClick={() => statement(x)}><FileText />Relevé annuel PDF</Button> },
        ]} />
      </Card>

      <ModalForm open={dialog === "pledge"} onOpenChange={(o) => !o && close()} title="Nouvelle promesse de don"><PledgeForm onClose={close} /></ModalForm>
      <ModalForm open={dialog === "commitment"} onOpenChange={(o) => !o && close()} title="Nouvel engagement de dépense"><CommitmentForm onClose={close} /></ModalForm>
      <ModalForm open={dialog === "member"} onOpenChange={(o) => !o && close()} title="Nouveau membre" className="sm:max-w-md"><MemberForm onClose={close} /></ModalForm>
    </>
  );
}

const currency = z.enum(CURRENCIES);

const pledgeSchema = z.object({
  memberId: z.string().optional(), donorName: z.string().optional(), categoryId: requiredSelect("Catégorie requise"),
  currency, amount: amountField, dueDate: z.string().optional(),
}).refine((v) => v.memberId || v.donorName?.trim(), { path: ["donorName"], message: "Choisissez un membre ou saisissez un nom" });

function PledgeForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const recettes = useCategories("recette");
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<Member[]>("/engagements/members") });
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof pledgeSchema>>({ resolver: zodResolver(pledgeSchema), defaultValues: { currency: "CDF", categoryId: "", amount: "" } });
  const add = useMutation({
    mutationFn: (v: z.infer<typeof pledgeSchema>) => api.post("/engagements/pledges", { donorName: v.donorName || undefined, memberId: v.memberId || undefined, categoryId: v.categoryId, currency: v.currency, amountMinor: parseAmount(v.amount).toString(), dueDate: v.dueDate || undefined }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate>
      <FormGrid>
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

const commitmentSchema = z.object({ payee: z.string().trim().min(1, "Bénéficiaire requis"), categoryId: requiredSelect("Catégorie requise"), currency, amount: amountField, dueDate: z.string().optional() });

function CommitmentForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const depenses = useCategories("depense");
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof commitmentSchema>>({ resolver: zodResolver(commitmentSchema), defaultValues: { currency: "CDF", categoryId: "", amount: "", payee: "" } });
  const add = useMutation({
    mutationFn: (v: z.infer<typeof commitmentSchema>) => api.post("/engagements/commitments", { payee: v.payee, categoryId: v.categoryId, currency: v.currency, amountMinor: parseAmount(v.amount).toString(), dueDate: v.dueDate || undefined }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate>
      <FormGrid>
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

const memberSchema = z.object({ fullName: z.string().trim().min(1, "Nom requis"), phone: z.string().optional() });

function MemberForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof memberSchema>>({ resolver: zodResolver(memberSchema) });
  const add = useMutation({ mutationFn: (v: z.infer<typeof memberSchema>) => api.post("/engagements/members", { fullName: v.fullName, phone: v.phone || undefined }), onSuccess: () => { invalidate(); onClose(); } });
  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate className="space-y-3">
      <Field label="Nom complet" error={errors.fullName?.message}><Input autoFocus {...register("fullName")} /></Field>
      <Field label="Téléphone"><Input {...register("phone")} /></Field>
      <ErrorNote error={add.error} />
      <FormFooter pending={add.isPending} onCancel={onClose} />
    </form>
  );
}

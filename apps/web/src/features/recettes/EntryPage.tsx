import { useState } from "react";
import { FormDate, FormSelect, dateLimits } from "@/components/form-controls";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, CheckCheck, ListChecks, Paperclip, Pencil, Plus, Receipt, Send, Trash2, Undo2, X } from "lucide-react";
import { parseAmount, isEditable, type Currency } from "@church/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ActionButton, Banner, Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader, ReasonButton, ReasonDialog, StatusBadge } from "@/components/common";
import { useApi } from "../../core/api";
import { amountField, requiredSelect } from "../../core/forms";
import { fmtDate, money, today } from "../../core/format";
import { queueDraft, useOnline } from "../../core/offline";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { receiptPdf } from "./receipt";
import { ValidationFlowButton, countByStatus } from "../validation/ValidationFlow";

const schema = z.object({
  date: z.string().min(1, "Date requise"),
  accountId: requiredSelect("Compte requis"),
  categoryId: requiredSelect("Catégorie requise"),
  amount: amountField,
  description: z.string().optional(),
  beneficiary: z.string().optional(),
  documentNumber: z.string().optional(),
  departmentId: z.string().optional(),
  memberId: z.string().optional(),
  pledgeId: z.string().optional(),
  subCategory: z.string().optional(),
  commitmentId: z.string().optional(),
});
/** Exact minor units -> "1234,56" for the amount input (no float). */
const exactAmount = (minor: string) => { const s = BigInt(minor).toString().padStart(3, "0"); return `${s.slice(0, -2)},${s.slice(-2)}`; };
const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");
type FormValues = z.infer<typeof schema>;

/** Recettes and Dépenses share one entry form pattern; only labels and extra fields differ. */
export function EntryPage({ kind }: { kind: "recette" | "depense" }) {
  const api = useApi();
  const s = useSession();
  const online = useOnline();
  const invalidate = useInvalidateLedger();
  const isRecette = kind === "recette";
  const accounts = useAccounts();
  const categories = useCategories(kind);
  const [dialog, setDialog] = useState<{ editing: Tx | null } | null>(null);
  const [notice, setNotice] = useState("");

  const canEnter = s.can("transaction.create") && !s.consolidated;
  const list = useQuery({ queryKey: useScopedKey("tx", kind), queryFn: () => api.get<Tx[]>("/transactions", { kind }) });
  const catName = (id?: string | null) => categories.data?.find((c) => c.id === id)?.name ?? "";
  const acctName = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "";

  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      action === "delete" ? api.del(`/transactions/${id}`) : api.post(`/transactions/${id}/${action}`, body),
    onSuccess: invalidate,
  });
  const busy = (id: string, action: string) => act.isPending && act.variables?.id === id && act.variables?.action === action;
  const attach = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.upload(`/attachments/transaction/${id}`, file),
    onSuccess: () => setNotice("Pièce jointe ajoutée."),
  });

  // Same selection + batch flow as "À valider": Trésorier acts on Soumise, Pasteur on Validée 1; never on own entries.
  const step1 = s.can("transaction.validate1");
  const step2 = s.can("transaction.validate2");
  const canValidate = (step1 || step2) && !s.consolidated;
  const stepFor = (t: Tx) => (t.status === "soumise" && step1 ? "validate1" : t.status === "validee1" && step2 ? "validate2" : null);
  const selectable = (t: Tx) => t.enteredBy !== s.me.user.id && stepFor(t) !== null;
  const [selected, setSelected] = useState(new Set<string>());
  const [rejecting, setRejecting] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; ok: boolean; error?: string }>>([]);
  const batch = useMutation({
    mutationFn: ({ action, comment }: { action: string; comment?: string }) => api.post<{ results: typeof results }>(`/transactions/batch/${action}`, { ids: [...selected], comment }),
    onSuccess: (r) => { setResults(r.results); setSelected(new Set()); invalidate(); },
  });
  const failed = results.filter((r) => !r.ok);

  const title = isRecette ? "Recettes" : "Dépenses";
  return (
    <>
      <PageHeader title={title} icon={isRecette ? ArrowDownToLine : ArrowUpFromLine}>
        <span className="flex items-center gap-2">
          {!online && <Badge variant="secondary">Hors ligne</Badge>}
          <ValidationFlowButton counts={countByStatus(list.data)} />
          {canEnter && <Button onClick={() => setDialog({ editing: null })}><Plus /> {isRecette ? "Nouvelle recette" : "Nouvelle dépense"}</Button>}
        </span>
      </PageHeader>
      {notice && <Banner>{notice}</Banner>}

      <Card title="Écritures" icon={ListChecks} actions={canValidate && (
        <span className="inline-flex items-center gap-1.5">
          <ActionButton variant="destructive" icon={X} pending={batch.isPending && batch.variables?.action === "reject"} disabled={!selected.size || batch.isPending} onClick={() => setRejecting(true)}>Rejeter ({selected.size})</ActionButton>
          <ActionButton icon={CheckCheck} pending={batch.isPending && batch.variables?.action !== "reject"} disabled={!selected.size || batch.isPending} onClick={() => {
            const chosen = (list.data ?? []).filter((t) => selected.has(t.id));
            new Set(chosen.map(stepFor)).forEach((action) => action && batch.mutate({ action }));
          }}>Valider ({selected.size})</ActionButton>
        </span>
      )}>
        <ErrorNote error={act.error ?? attach.error ?? batch.error} />
        {failed.length > 0 && <ErrorNote error={new Error(`${failed.length} échec(s) : ${[...new Set(failed.map((f) => f.error))].join(" ; ")}`)} />}
        <DataTable<Tx>
          rows={list.data ?? []} loading={list.isLoading}
          select={canValidate ? { selected, onChange: setSelected, selectable } : undefined}
          emptyIcon={isRecette ? ArrowDownToLine : ArrowUpFromLine}
          empty={isRecette ? "Aucune recette enregistrée" : "Aucune dépense enregistrée"}
          columns={[
            { header: "Réf.", cell: (t) => t.reference },
            { header: "Date", cell: (t) => fmtDate(t.date) },
            { header: "Catégorie", cell: (t) => catName(t.categoryId) },
            { header: "Compte", cell: (t) => acctName(t.accountId) },
            { header: "N° pièce", cell: (t) => t.documentNumber ?? "" },
            { header: "Objet", cell: (t) => t.subCategory ?? "" },
            { header: "Montant", align: "right", cell: (t) => money(t.amountMinor, t.currency as Currency) },
            { header: "Statut", cell: (t) => <StatusBadge status={t.status} /> },
            {
              header: "Validation", cell: (t) => (t.validator1Name || t.validator2Name) ? (
                <div className="text-xs leading-tight">
                  {t.validator1Name && <div>N1 : {t.validator1Name} <span className="text-muted-foreground">{at(t.validator1At)}</span></div>}
                  {t.validator2Name && <div>N2 : {t.validator2Name} <span className="text-muted-foreground">{at(t.validator2At)}</span></div>}
                </div>
              ) : "",
            },
            {
              header: "", cell: (t) => {
                const mine = t.enteredBy === s.me.user.id;
                return (
                  <span className="actions">
                    {canEnter && mine && isEditable(t.status) && <Button size="sm" variant="outline" onClick={() => setDialog({ editing: t })}><Pencil />Modifier</Button>}
                    {canEnter && mine && isEditable(t.status) && <ActionButton size="sm" icon={Send} pending={busy(t.id, "submit")} onClick={() => act.mutate({ id: t.id, action: "submit" })}>Soumettre</ActionButton>}
                    {canEnter && mine && t.status === "brouillon" && <ActionButton size="sm" variant="destructive" icon={Trash2} pending={busy(t.id, "delete")} onClick={() => act.mutate({ id: t.id, action: "delete" })}>Supprimer</ActionButton>}
                    {canEnter && t.status === "validee" && !t.reversesId && <ReasonButton danger icon={Undo2} label="Contre-passer" onConfirm={(comment) => act.mutate({ id: t.id, action: "reverse", body: { comment } })} />}
                    {canEnter && mine && isEditable(t.status) && (
                      <label className="cursor-pointer" title="Ajouter une pièce jointe">
                        <input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => e.target.files?.[0] && attach.mutate({ id: t.id, file: e.target.files[0] })} />
                        <Badge variant="outline">{attach.isPending && attach.variables?.id === t.id ? <Spinner /> : <Paperclip />} Pièce</Badge>
                      </label>
                    )}
                    {isRecette && t.status === "validee" && <Button size="sm" variant="outline" onClick={() => receiptPdf(t, s.parish?.name ?? "", catName(t.categoryId), acctName(t.accountId))}><Receipt />Reçu</Button>}
                  </span>
                );
              },
            },
          ]}
        />
      </Card>

      <ReasonDialog open={rejecting} onOpenChange={setRejecting} title={`Rejeter ${selected.size} écriture(s)`} label="Motif du rejet (envoyé au caissier)" confirmLabel="Rejeter" destructive
        onConfirm={(comment) => batch.mutate({ action: "reject", comment })} />

      <ModalForm
        open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.editing ? `Modifier ${dialog.editing.reference}` : isRecette ? "Nouvelle recette" : "Nouvelle dépense"}
        description="L'écriture est enregistrée en brouillon; soumettez-la ensuite pour validation."
      >
        {dialog && <EntryForm kind={kind} editing={dialog.editing} onClose={() => setDialog(null)} onOfflineSaved={() => setNotice("Hors ligne : brouillon enregistré sur cet appareil, il sera envoyé au retour de la connexion.")} />}
      </ModalForm>
    </>
  );
}

function EntryForm({ kind, editing, onClose, onOfflineSaved }: { kind: "recette" | "depense"; editing: Tx | null; onClose: () => void; onOfflineSaved: () => void }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const isRecette = kind === "recette";
  const accounts = useAccounts();
  const categories = useCategories(kind);
  const departments = useQuery({ queryKey: useScopedKey("departments"), queryFn: () => api.get<{ id: string; name: string }[]>("/departments") });
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<{ id: string; fullName: string }[]>("/engagements/members"), enabled: isRecette });
  const cfg = useQuery({ queryKey: useScopedKey("tx-config"), queryFn: () => api.get<{ pieceNumberMode: "manual" | "auto" | "mixed" }>("/transactions/config") });
  const pieceMode = cfg.data?.pieceNumberMode ?? "mixed";
  const commitments = useQuery({ queryKey: useScopedKey("commitments"), queryFn: () => api.get<{ id: string; payee: string; currency: string; amountMinor: string; status: string }[]>("/engagements/commitments"), enabled: !isRecette });
  const pledges = useQuery({ queryKey: useScopedKey("pledges"), queryFn: () => api.get<{ id: string; donorName?: string; categoryId: string }[]>("/engagements/pledges"), enabled: isRecette });

  const { register, control, handleSubmit, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? {
          date: editing.date, accountId: editing.accountId, categoryId: editing.categoryId ?? "",
          amount: exactAmount(editing.amountMinor), description: editing.description ?? "",
          beneficiary: editing.beneficiary ?? "", documentNumber: editing.documentNumber ?? "", departmentId: editing.departmentId ?? "",
          memberId: editing.memberId ?? "", pledgeId: editing.pledgeId ?? "",
          subCategory: editing.subCategory ?? "", commitmentId: editing.commitmentId ?? "",
        }
      : { date: today(), accountId: "", categoryId: "", amount: "" },
  });
  const account = accounts.data?.find((a) => a.id === watch("accountId"));
  const category = categories.data?.find((c) => c.id === watch("categoryId"));
  // Low-balance warning (dépenses): validated balance of the chosen account vs the typed amount.
  const accountId = watch("accountId");
  const balance = useQuery({ queryKey: ["tx-balance", accountId], queryFn: () => api.get<{ balance: string }>("/transactions/balance", { accountId }), enabled: !isRecette && !!accountId });
  let typed: bigint | null = null;
  try { typed = parseAmount(watch("amount") ?? ""); } catch { /* still typing */ }
  const lowBalance = !isRecette && balance.data && typed !== null && BigInt(balance.data.balance) < typed;

  const save = useMutation({
    mutationFn: async ({ f }: { f: FormValues; another: boolean }) => {
      const body = {
        parishId: s.parishId, kind, accountId: f.accountId, categoryId: f.categoryId, date: f.date,
        amountMinor: parseAmount(f.amount).toString(), description: f.description || undefined,
        beneficiary: f.beneficiary || undefined, documentNumber: f.documentNumber || undefined,
        departmentId: f.departmentId || undefined, memberId: f.memberId || undefined, pledgeId: f.pledgeId || undefined,
        subCategory: f.subCategory || undefined, commitmentId: !isRecette ? f.commitmentId || undefined : undefined,
      };
      if (editing) return api.patch<Tx>(`/transactions/${editing.id}`, body);
      try {
        return await api.post<Tx>("/transactions", body);
      } catch (e: any) {
        if (e?.status) throw e; // server answered: real error
        await queueDraft(s.parishId, body); // network failure: keep as offline draft
        onOfflineSaved();
        return null;
      }
    },
    onSuccess: (_r, { f, another }) => {
      invalidate();
      if (another) reset({ date: f.date, accountId: f.accountId, categoryId: f.categoryId, amount: "" }); // keep context for the next line
      else onClose();
    },
  });
  const submit = (another: boolean) => handleSubmit((f) => save.mutate({ f, another }));

  return (
    <form onSubmit={submit(false)} noValidate>
      <FormGrid>
        <Field label="Date" error={errors.date?.message}><FormDate control={control} name="date" {...dateLimits.past()} /></Field>
        <Field label="Compte" error={errors.accountId?.message}>
          <FormSelect control={control} name="accountId" options={[{ value: "", label: "—" }, ...(accounts.data?.filter((a) => a.active) ?? []).map((a) => ({ value: a.id, label: <>{a.name} ({a.currency})</> }))]} />
        </Field>
        <Field label="Catégorie" error={errors.categoryId?.message}>
          <FormSelect control={control} name="categoryId" options={[{ value: "", label: "—" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: <>{c.group ? `${c.group} · ` : ""}{c.name}</> }))]} />
        </Field>
        <Field label={`Montant ${account ? `(${account.currency})` : ""}`} error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        {category?.requiresDepartment && (
          <Field label="Département"><FormSelect control={control} name="departmentId" options={[{ value: "", label: "—" }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} /></Field>
        )}
        {isRecette && category?.name === "Dîme" && (
          <Field label="Membre (optionnel)"><FormSelect control={control} name="memberId" options={[{ value: "", label: "—" }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.fullName }))]} /></Field>
        )}
        {isRecette && !!pledges.data?.length && (
          <Field label="Promesse liée (optionnel)"><FormSelect control={control} name="pledgeId" options={[{ value: "", label: "—" }, ...(pledges.data ?? []).map((p) => ({ value: p.id, label: p.donorName ?? p.id.slice(0, 8) }))]} /></Field>
        )}
        <Field label="Sous-catégorie / objet"><Input {...register("subCategory")} /></Field>
        {!isRecette && <Field label="Bénéficiaire"><Input {...register("beneficiary")} /></Field>}
        {!isRecette && !!commitments.data?.some((m) => m.status === "open") && (
          <Field label="Engagement associé (optionnel)"><FormSelect control={control} name="commitmentId" options={[{ value: "", label: "—" }, ...commitments.data.filter((m) => m.status === "open" || m.id === editing?.commitmentId).map((m) => ({ value: m.id, label: `${m.payee} · ${money(m.amountMinor, m.currency as Currency)}` }))]} /></Field>
        )}
        {pieceMode === "auto"
          ? <Field label="N° pièce"><Input disabled placeholder="Généré automatiquement" value={editing?.documentNumber ?? ""} readOnly /></Field>
          : <Field label={pieceMode === "manual" ? "N° pièce (obligatoire)" : "N° pièce (généré si vide)"}><Input placeholder={isRecette ? "Reçu, carnet…" : "Facture, reçu, bon de sortie"} {...register("documentNumber")} /></Field>}
        <div className="col-span-full"><Field label="Description"><Input {...register("description")} /></Field></div>
      </FormGrid>
      {lowBalance && <div role="alert" className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Solde insuffisant : {money(balance.data!.balance, (account?.currency ?? "CDF") as Currency)} disponible sur ce compte, la dépense ne pourra pas être validée tant que le solde est inférieur au montant.</div>}
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter
        pending={save.isPending && !save.variables?.another} onCancel={onClose}
        extra={!editing && <ActionButton type="button" variant="outline" icon={Plus} pending={save.isPending && save.variables?.another} disabled={save.isPending} onClick={submit(true)}>Enregistrer et ajouter une autre</ActionButton>}
      />
    </form>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Paperclip, Plus } from "lucide-react";
import { parseAmount, isEditable, type Currency } from "@church/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Banner, Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader, ReasonButton, StatusBadge } from "@/components/common";
import { useApi } from "../../core/api";
import { amountField, requiredSelect } from "../../core/forms";
import { fmtDate, money, today } from "../../core/format";
import { queueDraft, useOnline } from "../../core/offline";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { receiptPdf } from "./receipt";

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
});
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
  const attach = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.upload(`/attachments/transaction/${id}`, file),
    onSuccess: () => setNotice("Pièce jointe ajoutée."),
  });

  const title = isRecette ? "Recettes" : "Dépenses";
  return (
    <>
      <PageHeader title={title}>
        <span className="flex items-center gap-2">
          {!online && <Badge variant="secondary">Hors ligne</Badge>}
          {canEnter && <Button onClick={() => setDialog({ editing: null })}><Plus /> {isRecette ? "Nouvelle recette" : "Nouvelle dépense"}</Button>}
        </span>
      </PageHeader>
      {notice && <Banner>{notice}</Banner>}

      <Card title="Écritures">
        <ErrorNote error={act.error ?? attach.error} />
        <DataTable<Tx>
          rows={list.data ?? []}
          columns={[
            { header: "Réf.", cell: (t) => t.reference },
            { header: "Date", cell: (t) => fmtDate(t.date) },
            { header: "Catégorie", cell: (t) => catName(t.categoryId) },
            { header: "Compte", cell: (t) => acctName(t.accountId) },
            { header: "Montant", align: "right", cell: (t) => money(t.amountMinor, t.currency as Currency) },
            { header: "Statut", cell: (t) => <StatusBadge status={t.status} /> },
            {
              header: "", cell: (t) => {
                const mine = t.enteredBy === s.me.user.id;
                return (
                  <span className="actions">
                    {canEnter && mine && isEditable(t.status) && <Button size="sm" variant="outline" onClick={() => setDialog({ editing: t })}>Modifier</Button>}
                    {canEnter && mine && isEditable(t.status) && <Button size="sm" onClick={() => act.mutate({ id: t.id, action: "submit" })}>Soumettre</Button>}
                    {canEnter && mine && t.status === "brouillon" && <Button size="sm" variant="destructive" onClick={() => act.mutate({ id: t.id, action: "delete" })}>Supprimer</Button>}
                    {canEnter && t.status === "validee" && !t.reversesId && <ReasonButton danger label="Contre-passer" onConfirm={(comment) => act.mutate({ id: t.id, action: "reverse", body: { comment } })} />}
                    {canEnter && mine && isEditable(t.status) && (
                      <label className="cursor-pointer" title="Ajouter une pièce jointe">
                        <input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => e.target.files?.[0] && attach.mutate({ id: t.id, file: e.target.files[0] })} />
                        <Badge variant="outline"><Paperclip /> Pièce</Badge>
                      </label>
                    )}
                    {isRecette && t.status === "validee" && <Button size="sm" variant="outline" onClick={() => receiptPdf(t, s.parish?.name ?? "", catName(t.categoryId), acctName(t.accountId))}>Reçu</Button>}
                  </span>
                );
              },
            },
          ]}
        />
      </Card>

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
  const pledges = useQuery({ queryKey: useScopedKey("pledges"), queryFn: () => api.get<{ id: string; donorName?: string; categoryId: string }[]>("/engagements/pledges"), enabled: isRecette });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? {
          date: editing.date, accountId: editing.accountId, categoryId: editing.categoryId ?? "",
          amount: (Number(editing.amountMinor) / 100).toFixed(2).replace(".", ","), description: editing.description ?? "",
          beneficiary: editing.beneficiary ?? "", documentNumber: editing.documentNumber ?? "", departmentId: editing.departmentId ?? "",
          memberId: editing.memberId ?? "", pledgeId: editing.pledgeId ?? "",
        }
      : { date: today(), accountId: "", categoryId: "", amount: "" },
  });
  const account = accounts.data?.find((a) => a.id === watch("accountId"));
  const category = categories.data?.find((c) => c.id === watch("categoryId"));

  const save = useMutation({
    mutationFn: async ({ f }: { f: FormValues; another: boolean }) => {
      const body = {
        parishId: s.parishId, kind, accountId: f.accountId, categoryId: f.categoryId, date: f.date,
        amountMinor: parseAmount(f.amount).toString(), description: f.description || undefined,
        beneficiary: f.beneficiary || undefined, documentNumber: f.documentNumber || undefined,
        departmentId: f.departmentId || undefined, memberId: f.memberId || undefined, pledgeId: f.pledgeId || undefined,
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
        <Field label="Date" error={errors.date?.message}><Input type="date" {...register("date")} /></Field>
        <Field label="Compte" error={errors.accountId?.message}>
          <NativeSelect {...register("accountId")}><option value="">—</option>{accounts.data?.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</NativeSelect>
        </Field>
        <Field label="Catégorie" error={errors.categoryId?.message}>
          <NativeSelect {...register("categoryId")}><option value="">—</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.group ? `${c.group} · ` : ""}{c.name}</option>)}</NativeSelect>
        </Field>
        <Field label={`Montant ${account ? `(${account.currency})` : ""}`} error={errors.amount?.message}><Input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
        {category?.requiresDepartment && (
          <Field label="Département"><NativeSelect {...register("departmentId")}><option value="">—</option>{departments.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Field>
        )}
        {isRecette && category?.name === "Dîme" && (
          <Field label="Membre (optionnel)"><NativeSelect {...register("memberId")}><option value="">—</option>{members.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</NativeSelect></Field>
        )}
        {isRecette && !!pledges.data?.length && (
          <Field label="Promesse liée (optionnel)"><NativeSelect {...register("pledgeId")}><option value="">—</option>{pledges.data.map((p) => <option key={p.id} value={p.id}>{p.donorName ?? p.id.slice(0, 8)}</option>)}</NativeSelect></Field>
        )}
        {!isRecette && <Field label="Bénéficiaire"><Input {...register("beneficiary")} /></Field>}
        <Field label={isRecette ? "Référence" : "N° pièce (facture, reçu, bon de sortie)"}><Input {...register("documentNumber")} /></Field>
        <div className="col-span-full"><Field label="Description"><Input {...register("description")} /></Field></div>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter
        pending={save.isPending} onCancel={onClose} submitLabel={editing ? "Enregistrer" : "Enregistrer"}
        extra={!editing && <Button type="button" variant="outline" disabled={save.isPending} onClick={submit(true)}>Enregistrer et ajouter une autre</Button>}
      />
    </form>
  );
}

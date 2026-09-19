import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAmount, isEditable, type Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money, today } from "../../core/format";
import { queueDraft, useOnline } from "../../core/offline";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { Card, DataTable, ErrorNote, Field, ReasonButton, StatusBadge } from "../../components/ui";
import { receiptPdf } from "./receipt";

const schema = z.object({
  date: z.string().min(1, "Date requise"),
  accountId: z.string().uuid("Compte requis"),
  categoryId: z.string().uuid("Catégorie requise"),
  amount: z.string().refine((v) => { try { return parseAmount(v) > 0n; } catch { return false; } }, "Montant invalide"),
  description: z.string().optional(),
  beneficiary: z.string().optional(),
  documentNumber: z.string().optional(),
  departmentId: z.string().optional(),
  memberId: z.string().optional(),
  pledgeId: z.string().optional(),
});
type Form = z.infer<typeof schema>;

/** Recettes and Dépenses share one entry form pattern; only labels and extra fields differ. */
export function EntryPage({ kind }: { kind: "recette" | "depense" }) {
  const api = useApi();
  const s = useSession();
  const online = useOnline();
  const invalidate = useInvalidateLedger();
  const isRecette = kind === "recette";
  const accounts = useAccounts();
  const categories = useCategories(kind);
  const [editing, setEditing] = useState<Tx | null>(null);
  const [notice, setNotice] = useState("");

  const canEnter = s.can("transaction.create") && !s.consolidated;
  const list = useQuery({ queryKey: useScopedKey("tx", kind), queryFn: () => api.get<Tx[]>("/transactions", { kind }) });
  const departments = useQuery({ queryKey: useScopedKey("departments"), queryFn: () => api.get<{ id: string; name: string }[]>("/departments"), enabled: !s.consolidated });
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<{ id: string; fullName: string }[]>("/engagements/members"), enabled: !s.consolidated && isRecette });
  const pledges = useQuery({ queryKey: useScopedKey("pledges"), queryFn: () => api.get<{ id: string; donorName?: string; categoryId: string }[]>("/engagements/pledges"), enabled: !s.consolidated && isRecette });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema), defaultValues: { date: today() },
  });
  const accountId = watch("accountId");
  const categoryId = watch("categoryId");
  const account = accounts.data?.find((a) => a.id === accountId);
  const category = categories.data?.find((c) => c.id === categoryId);
  const catName = (id?: string | null) => categories.data?.find((c) => c.id === id)?.name ?? "";
  const acctName = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "";

  const save = useMutation({
    mutationFn: async (f: Form) => {
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
        setNotice("Hors ligne : brouillon enregistré sur cet appareil, il sera envoyé au retour de la connexion.");
        return null;
      }
    },
    onSuccess: (_r, f) => {
      // Keep date, account and category between saves for fast entry after a service.
      reset({ date: f.date, accountId: f.accountId, categoryId: f.categoryId });
      setEditing(null);
      invalidate();
    },
  });

  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      action === "delete" ? api.del(`/transactions/${id}`) : api.post(`/transactions/${id}/${action}`, body),
    onSuccess: invalidate,
  });
  const attach = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.upload(`/attachments/transaction/${id}`, file),
    onSuccess: () => setNotice("Pièce jointe ajoutée."),
  });

  const edit = (t: Tx) => {
    setEditing(t);
    reset({
      date: t.date, accountId: t.accountId, categoryId: t.categoryId ?? "", amount: (Number(t.amountMinor) / 100).toFixed(2).replace(".", ","),
      description: t.description ?? "", beneficiary: t.beneficiary ?? "", documentNumber: t.documentNumber ?? "",
      departmentId: t.departmentId ?? "", memberId: t.memberId ?? "", pledgeId: t.pledgeId ?? "",
    });
  };

  const usable = useMemo(() => accounts.data?.filter((a) => a.active) ?? [], [accounts.data]);
  const title = isRecette ? "Recettes" : "Dépenses";

  return (
    <>
      <div className="topbar"><h2>{title}</h2>{!online && <span className="badge badge-soumise">Hors ligne</span>}</div>
      {notice && <div className="banner">{notice}</div>}

      {canEnter && (
        <Card title={editing ? `Modifier ${editing.reference}` : `Nouvelle ${isRecette ? "recette" : "dépense"}`}>
          <form onSubmit={handleSubmit((f) => save.mutate(f))} className="form-grid">
            <Field label="Date" error={errors.date?.message}><input type="date" {...register("date")} /></Field>
            <Field label="Compte" error={errors.accountId?.message}>
              <select {...register("accountId")}><option value="">—</option>{usable.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select>
            </Field>
            <Field label="Catégorie" error={errors.categoryId?.message}>
              <select {...register("categoryId")}><option value="">—</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.group ? `${c.group} · ` : ""}{c.name}</option>)}</select>
            </Field>
            <Field label={`Montant ${account ? `(${account.currency})` : ""}`} error={errors.amount?.message}><input inputMode="decimal" placeholder="0,00" {...register("amount")} /></Field>
            {category?.requiresDepartment && (
              <Field label="Département">
                <select {...register("departmentId")}><option value="">—</option>{departments.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              </Field>
            )}
            {isRecette && category?.name === "Dîme" && (
              <Field label="Membre (optionnel)">
                <select {...register("memberId")}><option value="">—</option>{members.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select>
              </Field>
            )}
            {isRecette && !!pledges.data?.length && (
              <Field label="Promesse liée (optionnel)">
                <select {...register("pledgeId")}><option value="">—</option>{pledges.data.map((p) => <option key={p.id} value={p.id}>{p.donorName ?? p.id.slice(0, 8)}</option>)}</select>
              </Field>
            )}
            {!isRecette && <Field label="Bénéficiaire"><input {...register("beneficiary")} /></Field>}
            <Field label={isRecette ? "Référence" : "N° pièce (facture, reçu, bon de sortie)"}><input {...register("documentNumber")} /></Field>
            <Field label="Description"><input {...register("description")} /></Field>
            <div className="actions">
              <button type="submit" disabled={save.isPending}>{editing ? "Enregistrer" : "Ajouter (brouillon)"}</button>
              {editing && <button type="button" className="ghost" onClick={() => { setEditing(null); reset({ date: today() }); }}>Annuler</button>}
            </div>
          </form>
          <ErrorNote error={save.error} />
        </Card>
      )}

      <Card title="Écritures">
        <ErrorNote error={act.error} />
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
                    {canEnter && mine && isEditable(t.status) && <button className="ghost" onClick={() => edit(t)}>Modifier</button>}
                    {canEnter && mine && isEditable(t.status) && <button onClick={() => act.mutate({ id: t.id, action: "submit" })}>Soumettre</button>}
                    {canEnter && mine && t.status === "brouillon" && <button className="danger" onClick={() => act.mutate({ id: t.id, action: "delete" })}>Supprimer</button>}
                    {canEnter && t.status === "validee" && !t.reversesId && <ReasonButton danger label="Contre-passer" onConfirm={(comment) => act.mutate({ id: t.id, action: "reverse", body: { comment } })} />}
                    {canEnter && mine && isEditable(t.status) && (
                      <label className="ghost-file"><input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => e.target.files?.[0] && attach.mutate({ id: t.id, file: e.target.files[0] })} /><span className="badge">📎</span></label>
                    )}
                    {isRecette && t.status === "validee" && <button className="ghost" onClick={() => receiptPdf(t, s.parish?.name ?? "", catName(t.categoryId), acctName(t.accountId))}>Reçu</button>}
                  </span>
                );
              },
            },
          ]}
        />
      </Card>
    </>
  );
}

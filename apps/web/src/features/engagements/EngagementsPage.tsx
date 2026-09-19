import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAmount, type Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { Card, DataTable, ErrorNote, Field } from "../../components/ui";
import { exportPdf } from "../journal/export";

interface Pledge { id: string; memberId?: string | null; donorName?: string | null; categoryId: string; currency: Currency; amountMinor: string; dueDate?: string | null }
interface Commitment { id: string; categoryId: string; payee: string; currency: Currency; amountMinor: string; dueDate?: string | null; status: string }
interface Member { id: string; fullName: string; phone?: string | null }

export function EngagementsPage() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  const recettes = useCategories("recette");
  const depenses = useCategories("depense");
  const pledges = useQuery({ queryKey: useScopedKey("pledges"), queryFn: () => api.get<Pledge[]>("/engagements/pledges") });
  const commitments = useQuery({ queryKey: useScopedKey("commitments"), queryFn: () => api.get<Commitment[]>("/engagements/commitments") });
  const members = useQuery({ queryKey: useScopedKey("members"), queryFn: () => api.get<Member[]>("/engagements/members") });
  const txs = useQuery({ queryKey: useScopedKey("tx", "recette"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "recette" }) });
  const received = (id: string) => (txs.data ?? []).filter((t) => t.pledgeId === id && t.status === "validee").reduce((a, t) => a + BigInt(t.amountMinor), 0n);

  const [p, setP] = useState({ donor: "", memberId: "", categoryId: "", currency: "CDF", amount: "", due: "" });
  const [c, setC] = useState({ payee: "", categoryId: "", currency: "CDF", amount: "", due: "" });
  const [m, setM] = useState({ fullName: "", phone: "" });
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const addPledge = useMutation({ mutationFn: () => api.post("/engagements/pledges", { donorName: p.donor || undefined, memberId: p.memberId || undefined, categoryId: p.categoryId, currency: p.currency, amountMinor: parseAmount(p.amount).toString(), dueDate: p.due || undefined }), onSuccess: () => { setP({ ...p, donor: "", amount: "" }); invalidate(); } });
  const addCommitment = useMutation({ mutationFn: () => api.post("/engagements/commitments", { payee: c.payee, categoryId: c.categoryId, currency: c.currency, amountMinor: parseAmount(c.amount).toString(), dueDate: c.due || undefined }), onSuccess: () => { setC({ ...c, payee: "", amount: "" }); invalidate(); } });
  const addMember = useMutation({ mutationFn: () => api.post("/engagements/members", { fullName: m.fullName, phone: m.phone || undefined }), onSuccess: () => { setM({ fullName: "", phone: "" }); invalidate(); } });
  const markPaid = useMutation({ mutationFn: (v: { id: string; transactionId: string }) => api.post(`/engagements/commitments/${v.id}/paid`, { transactionId: v.transactionId }), onSuccess: invalidate });
  const depenseTx = useQuery({ queryKey: useScopedKey("tx", "depense"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "depense", status: "validee" }) });

  const statement = (member: Member) => {
    const rows = (txs.data ?? []).filter((t) => t.memberId === member.id && t.status === "validee" && t.date.startsWith(year));
    exportPdf(`Relevé de dons ${year} — ${member.fullName}`, ["Date", "Référence", "Catégorie", "Montant"],
      rows.map((t) => [fmtDate(t.date), t.reference, recettes.data?.find((x) => x.id === t.categoryId)?.name ?? "", money(t.amountMinor, t.currency)]));
  };
  const set = <T extends object>(o: T, f: (v: T) => void, k: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => f({ ...o, [k]: e.target.value });
  const curSel = (v: string, on: (e: any) => void) => <select value={v} onChange={on}><option>CDF</option><option>USD</option></select>;

  return (
    <>
      <div className="topbar"><h2>Engagements</h2></div>
      <Card title="Promesses de dons">
        {canEnter && (
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <Field label="Membre"><select value={p.memberId} onChange={set(p, setP, "memberId")}><option value="">—</option>{members.data?.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</select></Field>
            <Field label="ou nom du donateur/partenaire"><input value={p.donor} onChange={set(p, setP, "donor")} /></Field>
            <Field label="Catégorie"><select value={p.categoryId} onChange={set(p, setP, "categoryId")}><option value="">—</option>{recettes.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Devise">{curSel(p.currency, set(p, setP, "currency"))}</Field>
            <Field label="Montant promis"><input value={p.amount} onChange={set(p, setP, "amount")} inputMode="decimal" /></Field>
            <Field label="Échéance"><input type="date" value={p.due} onChange={set(p, setP, "due")} /></Field>
            <button disabled={addPledge.isPending} onClick={() => addPledge.mutate()}>Ajouter</button>
          </div>
        )}
        <ErrorNote error={addPledge.error} />
        <DataTable<Pledge> rows={pledges.data ?? []} columns={[
          { header: "Donateur", cell: (x) => x.donorName ?? members.data?.find((mm) => mm.id === x.memberId)?.fullName ?? "" },
          { header: "Catégorie", cell: (x) => recettes.data?.find((r) => r.id === x.categoryId)?.name ?? "" },
          { header: "Échéance", cell: (x) => fmtDate(x.dueDate) },
          { header: "Promis", align: "right", cell: (x) => money(x.amountMinor, x.currency) },
          { header: "Reçu", align: "right", cell: (x) => money(received(x.id), x.currency) },
          { header: "Reste", align: "right", cell: (x) => money(BigInt(x.amountMinor) - received(x.id), x.currency) },
        ]} />
        <p className="muted">Chaque paiement est une recette normale liée à la promesse (champ « Promesse liée » dans Recettes).</p>
      </Card>

      <Card title="Engagements de dépenses">
        {canEnter && (
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <Field label="Bénéficiaire"><input value={c.payee} onChange={set(c, setC, "payee")} /></Field>
            <Field label="Catégorie"><select value={c.categoryId} onChange={set(c, setC, "categoryId")}><option value="">—</option>{depenses.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Devise">{curSel(c.currency, set(c, setC, "currency"))}</Field>
            <Field label="Montant"><input value={c.amount} onChange={set(c, setC, "amount")} inputMode="decimal" /></Field>
            <Field label="Échéance"><input type="date" value={c.due} onChange={set(c, setC, "due")} /></Field>
            <button disabled={addCommitment.isPending} onClick={() => addCommitment.mutate()}>Ajouter</button>
          </div>
        )}
        <ErrorNote error={addCommitment.error} />
        <DataTable<Commitment> rows={commitments.data ?? []} columns={[
          { header: "Bénéficiaire", cell: (x) => x.payee }, { header: "Échéance", cell: (x) => fmtDate(x.dueDate) },
          { header: "Montant", align: "right", cell: (x) => money(x.amountMinor, x.currency) }, { header: "Statut", cell: (x) => (x.status === "paid" ? "Payé" : "Ouvert") },
          { header: "", cell: (x) => canEnter && x.status === "open" && (
            <select defaultValue="" onChange={(e) => e.target.value && markPaid.mutate({ id: x.id, transactionId: e.target.value })}>
              <option value="">Lier à la dépense payée…</option>
              {depenseTx.data?.filter((t) => t.currency === x.currency).map((t) => <option key={t.id} value={t.id}>{t.reference} · {money(t.amountMinor, t.currency)}</option>)}
            </select>) },
        ]} />
      </Card>

      <Card title="Membres (dîme et relevés de dons)">
        {canEnter && (
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <Field label="Nom complet"><input value={m.fullName} onChange={set(m, setM, "fullName")} /></Field>
            <Field label="Téléphone"><input value={m.phone} onChange={set(m, setM, "phone")} /></Field>
            <button disabled={!m.fullName || addMember.isPending} onClick={() => addMember.mutate()}>Ajouter</button>
          </div>
        )}
        <Field label="Année du relevé"><input value={year} onChange={(e) => setYear(e.target.value)} /></Field>
        <DataTable<Member> rows={members.data ?? []} columns={[
          { header: "Nom", cell: (x) => x.fullName }, { header: "Téléphone", cell: (x) => x.phone ?? "" },
          { header: "", cell: (x) => s.can("report.export") && <button className="ghost" onClick={() => statement(x)}>Relevé annuel PDF</button> },
        ]} />
      </Card>
    </>
  );
}

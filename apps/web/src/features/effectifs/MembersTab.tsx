import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm } from "@/components/common";
import { useApi } from "../../core/api";
import { useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { fmtDate, money } from "../../core/format";
import type { Tx } from "../../core/types";
import { exportTable } from "@/lib/export-table";
import { useSession } from "../../core/session";
import { OptionSelect } from "@/components/form-controls";
import { ExportButtons } from "./ExportButtons";

export interface Member { id: string; fullName: string; address?: string | null; whatsapp?: string | null; phone?: string | null; email?: string | null; homeChurch?: string | null; invitedBy?: string | null }
const FIELDS = [["fullName", "Nom complet"], ["address", "Adresse"], ["whatsapp", "WhatsApp"], ["phone", "Téléphone"], ["email", "Email"], ["homeChurch", "Église d'attache"], ["invitedBy", "Personne ayant invité"]] as const;
type Mode = null | "choose" | "pick" | { edit: Member | null };
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function MembersTab() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canWrite = s.can("registry.write") && !s.consolidated;
  const [mode, setMode] = useState<Mode>(null);
  const [q, setQ] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const recettes = useCategories("recette");
  const txs = useQuery({ queryKey: useScopedKey("tx", "recette"), queryFn: () => api.get<Tx[]>("/transactions", { kind: "recette" }), enabled: s.can("report.export") });
  // Relevé annuel de dons d'un membre (validated recettes only).
  const statement = (m: Member) => {
    const list = (txs.data ?? []).filter((t) => t.memberId === m.id && t.status === "validee" && t.date.startsWith(year));
    exportTable("pdf", {
      title: `Relevé de dons ${year} — ${m.fullName}`,
      columns: [{ header: "Date", key: "date" }, { header: "Référence", key: "ref" }, { header: "Catégorie", key: "cat" }, { header: "Montant", key: "amount", align: "right" }],
      rows: list.map((t) => ({ date: fmtDate(t.date), ref: t.reference, cat: recettes.data?.find((x) => x.id === t.categoryId)?.name ?? "", amount: money(t.amountMinor, t.currency) })),
    });
  };
  const list = useQuery({ queryKey: useScopedKey("effectifs-members"), queryFn: () => api.get<Member[]>("/effectifs/members") });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/effectifs/members/${id}`), onSuccess: invalidate });
  const rows = useMemo(() => (list.data ?? []).filter((m) => !q || norm(FIELDS.map(([k]) => m[k] ?? "").join(" ")).includes(norm(q))), [list.data, q]);
  const spec = () => ({
    title: "Liste des membres", columns: FIELDS.map(([key, header]) => ({ header, key })), rows: rows.map((m) => ({ ...m })),
  });
  const close = () => setMode(null);
  return (
    <>
      <Card title="Membres" actions={<span className="flex flex-wrap items-center gap-2">{s.can("report.export") && <Input className="h-7 w-20" aria-label="Année du relevé" value={year} onChange={(e) => setYear(e.target.value)} />}<ExportButtons spec={spec} />{canWrite && <Button size="sm" onClick={() => setMode("choose")}><Plus /> Membre</Button>}</span>}>
        <div className="mb-3 relative max-w-sm"><Search className="absolute left-2 top-2 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Rechercher…" aria-label="Rechercher un membre" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ErrorNote error={del.error} />
        <DataTable<Member> rows={rows} loading={list.isLoading} emptyIcon={Users} empty="Aucun membre enregistré" pageSize={25} columns={[
          ...FIELDS.map(([k, h]) => ({ header: h, cell: (m: Member) => m[k] ?? "", sort: (m: Member) => m[k] })),
          { header: "", cell: (m) => (
            <span className="actions">
              {s.can("report.export") && <Button size="sm" variant="outline" onClick={() => statement(m)}><FileText />Relevé annuel PDF</Button>}
              {canWrite && <>
              <Button size="sm" variant="outline" onClick={() => setMode({ edit: m })}><Pencil />Modifier</Button>
              <Button size="sm" variant="ghost" aria-label={`Supprimer ${m.fullName}`} onClick={() => confirm(`Supprimer ${m.fullName} ?`) && del.mutate(m.id)}><Trash2 /></Button></>}
            </span>) },
        ]} />
      </Card>
      <ModalForm open={mode === "choose"} onOpenChange={(o) => !o && close()} title="Membre" className="sm:max-w-md">
        <div className="grid gap-2">
          <Button onClick={() => setMode({ edit: null })}><UserPlus />Nouveau membre</Button>
          <Button variant="outline" onClick={() => setMode("pick")}><Search />Membre existant</Button>
        </div>
      </ModalForm>
      <ModalForm open={mode === "pick"} onOpenChange={(o) => !o && close()} title="Membre existant" description="Recherchez puis choisissez le membre à modifier." className="sm:max-w-md">
        <Picker members={list.data ?? []} onPick={(m) => setMode({ edit: m })} />
      </ModalForm>
      <ModalForm open={typeof mode === "object" && mode !== null} onOpenChange={(o) => !o && close()} title={typeof mode === "object" && mode?.edit ? "Modifier le membre" : "Nouveau membre"}>
        {typeof mode === "object" && mode && <MemberForm key={mode.edit?.id ?? "new"} member={mode.edit} members={list.data ?? []} onClose={close} />}
      </ModalForm>
    </>
  );
}

function Picker({ members, onPick }: { members: Member[]; onPick: (m: Member) => void }) {
  const [q, setQ] = useState("");
  const found = members.filter((m) => norm(`${m.fullName} ${m.phone ?? ""} ${m.whatsapp ?? ""}`).includes(norm(q))).slice(0, 8);
  return (
    <div className="space-y-2">
      <Input autoFocus placeholder="Nom, téléphone…" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y rounded-md border">
        {found.map((m) => <li key={m.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(m)}>{m.fullName}<span className="ml-2 text-muted-foreground">{m.phone ?? m.whatsapp ?? ""}</span></button></li>)}
        {!found.length && <li className="px-3 py-2 text-sm text-muted-foreground">Aucun résultat</li>}
      </ul>
    </div>
  );
}

function MemberForm({ member, members, onClose }: { member: Member | null; members: Member[]; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, member?.[k] ?? ""])));
  const [err, setErr] = useState("");
  const save = useMutation({ mutationFn: () => (member ? api.put(`/effectifs/members/${member.id}`, v) : api.post("/effectifs/members", v)), onSuccess: () => { invalidate(); onClose(); } });
  // "Personne ayant invité": pick an existing member (not the member being edited); a name already stored stays selectable.
  const inviters = members.filter((m) => m.id !== member?.id).map((m) => m.fullName);
  if (v.invitedBy && !inviters.includes(v.invitedBy)) inviters.push(v.invitedBy);
  const inviterOptions = [{ value: "", label: "—" }, ...inviters.sort((a, b) => a.localeCompare(b, "fr")).map((n) => ({ value: n, label: n }))];
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!v.fullName!.trim()) return setErr("Nom requis"); setErr(""); save.mutate(); }} noValidate>
      <FormGrid>
        {FIELDS.map(([k, h]) => <Field key={k} label={h} error={k === "fullName" ? err : undefined}>
          {k === "invitedBy"
            ? <OptionSelect value={v[k]!} onValueChange={(x) => setV({ ...v, [k]: x })} options={inviterOptions} />
            : <Input autoFocus={k === "fullName"} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
        </Field>)}
      </FormGrid>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

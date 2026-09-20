import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { WORKER_CATEGORIES, WORKER_CATEGORY_LABELS, type WorkerCategory } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm } from "@/components/common";
import { OptionSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { ExportButtons } from "./ExportButtons";

interface Worker { id: string; category: WorkerCategory; fullName: string; address?: string | null; departmentId?: string | null; phone?: string | null; email?: string | null; whatsapp?: string | null; basicTeachingDone: boolean; active: boolean }
interface Dept { id: string; name: string }
const yn = (b: boolean) => (b ? "Oui" : "Non");
const catOptions = WORKER_CATEGORIES.map((c) => ({ value: c, label: WORKER_CATEGORY_LABELS[c] }));
const ynOptions = [{ value: "true", label: "Oui" }, { value: "false", label: "Non" }];

export function WorkersTab() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canWrite = s.can("registry.write") && !s.consolidated;
  const [edit, setEdit] = useState<Worker | null | undefined>(undefined); // undefined = closed, null = new
  const [f, setF] = useState({ category: "", department: "", teaching: "", q: "" });
  const list = useQuery({ queryKey: useScopedKey("workers"), queryFn: () => api.get<Worker[]>("/effectifs/workers") });
  const depts = useQuery({ queryKey: useScopedKey("departments"), queryFn: () => api.get<Dept[]>("/departments") });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/effectifs/workers/${id}`), onSuccess: invalidate });
  const dept = (id?: string | null) => depts.data?.find((d) => d.id === id)?.name ?? "";
  const rows = useMemo(() => (list.data ?? []).filter((w) =>
    (!f.category || w.category === f.category) && (!f.department || w.departmentId === f.department) && (!f.teaching || String(w.basicTeachingDone) === f.teaching)
    && (!f.q || w.fullName.toLowerCase().includes(f.q.toLowerCase()))), [list.data, f]);
  const spec = () => ({
    title: "Liste des ouvriers",
    columns: [{ header: "Catégorie", key: "cat" }, { header: "Nom complet", key: "name" }, { header: "Département", key: "dept" }, { header: "Adresse", key: "addr" }, { header: "Téléphone", key: "phone" }, { header: "WhatsApp", key: "wa" }, { header: "Email", key: "email" }, { header: "Enseignement de base", key: "teach" }, { header: "Actif", key: "active" }],
    rows: rows.map((w) => ({ cat: WORKER_CATEGORY_LABELS[w.category], name: w.fullName, dept: dept(w.departmentId), addr: w.address, phone: w.phone, wa: w.whatsapp, email: w.email, teach: yn(w.basicTeachingDone), active: yn(w.active) })),
  });
  return (
    <>
      <Card title="Ouvriers" actions={<span className="flex flex-wrap items-center gap-2"><ExportButtons spec={spec} />{canWrite && <Button size="sm" onClick={() => setEdit(null)}><Plus /> Ouvrier</Button>}</span>}>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input className="w-48" placeholder="Rechercher…" aria-label="Rechercher un ouvrier" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <OptionSelect size="sm" className="w-auto min-w-40" aria-label="Catégorie" placeholder="Toutes catégories" value={f.category} onValueChange={(v) => setF({ ...f, category: v })} options={[{ value: "", label: "Toutes catégories" }, ...catOptions]} />
          <OptionSelect size="sm" className="w-auto min-w-40" aria-label="Département" placeholder="Tous départements" value={f.department} onValueChange={(v) => setF({ ...f, department: v })} options={[{ value: "", label: "Tous départements" }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
          <OptionSelect size="sm" className="w-auto min-w-48" aria-label="Enseignement de base" placeholder="Enseignement de base" value={f.teaching} onValueChange={(v) => setF({ ...f, teaching: v })} options={[{ value: "", label: "Enseignement : tous" }, { value: "true", label: "Enseignement fait : Oui" }, { value: "false", label: "Enseignement fait : Non" }]} />
        </div>
        <ErrorNote error={del.error} />
        <DataTable<Worker> rows={rows} loading={list.isLoading} emptyIcon={Users} empty="Aucun ouvrier enregistré" pageSize={25} columns={[
          { header: "Catégorie", cell: (w) => WORKER_CATEGORY_LABELS[w.category], sort: (w) => w.category }, { header: "Nom", cell: (w) => w.fullName, sort: (w) => w.fullName },
          { header: "Département", cell: (w) => dept(w.departmentId) }, { header: "Téléphone", cell: (w) => w.phone ?? "" }, { header: "WhatsApp", cell: (w) => w.whatsapp ?? "" },
          { header: "Ens. de base", cell: (w) => yn(w.basicTeachingDone) }, { header: "Actif", cell: (w) => yn(w.active) },
          { header: "", cell: (w) => canWrite && (
            <span className="actions">
              <Button size="sm" variant="outline" onClick={() => setEdit(w)}><Pencil />Modifier</Button>
              <Button size="sm" variant="ghost" aria-label={`Supprimer ${w.fullName}`} onClick={() => confirm(`Supprimer ${w.fullName} ?`) && del.mutate(w.id)}><Trash2 /></Button>
            </span>) },
        ]} />
      </Card>
      <ModalForm open={edit !== undefined} onOpenChange={(o) => !o && setEdit(undefined)} title={edit ? "Modifier l'ouvrier" : "Nouvel ouvrier"}>
        {edit !== undefined && <WorkerForm key={edit?.id ?? "new"} worker={edit} depts={depts.data ?? []} onClose={() => setEdit(undefined)} />}
      </ModalForm>
    </>
  );
}

function WorkerForm({ worker, depts, onClose }: { worker: Worker | null; depts: Dept[]; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const [v, setV] = useState({
    category: worker?.category ?? "ouvrier", fullName: worker?.fullName ?? "", address: worker?.address ?? "", departmentId: worker?.departmentId ?? "",
    phone: worker?.phone ?? "", email: worker?.email ?? "", whatsapp: worker?.whatsapp ?? "", basicTeachingDone: worker?.basicTeachingDone ?? false, active: worker?.active ?? true,
  });
  const [err, setErr] = useState("");
  const save = useMutation({ mutationFn: () => (worker ? api.put(`/effectifs/workers/${worker.id}`, v) : api.post("/effectifs/workers", v)), onSuccess: () => { invalidate(); onClose(); } });
  const txt = (k: "address" | "phone" | "email" | "whatsapp", label: string) => <Field label={label}><Input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!v.fullName.trim()) return setErr("Nom requis"); setErr(""); save.mutate(); }} noValidate>
      <FormGrid>
        <Field label="Catégorie"><OptionSelect value={v.category} onValueChange={(c) => setV({ ...v, category: c as WorkerCategory })} options={catOptions} /></Field>
        <Field label="Nom complet" error={err}><Input autoFocus value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} /></Field>
        <Field label="Département"><OptionSelect value={v.departmentId} onValueChange={(d) => setV({ ...v, departmentId: d })} placeholder="Aucun" options={[{ value: "", label: "Aucun" }, ...depts.map((d) => ({ value: d.id, label: d.name }))]} /></Field>
        {txt("address", "Adresse")}{txt("phone", "Téléphone")}{txt("whatsapp", "WhatsApp")}{txt("email", "Email")}
        <Field label="Enseignement de base fait"><OptionSelect value={String(v.basicTeachingDone)} onValueChange={(b) => setV({ ...v, basicTeachingDone: b === "true" })} options={ynOptions} /></Field>
        <Field label="Actif"><OptionSelect value={String(v.active)} onValueChange={(b) => setV({ ...v, active: b === "true" })} options={ynOptions} /></Field>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

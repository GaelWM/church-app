import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, ExportButtons, Field, FormFooter, FormGrid, ModalForm } from "@/components/common";
import { OptionSelect } from "@/components/form-controls";
import { fmtDate } from "../../core/format";
import { useApi } from "../../core/api";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";

export interface Newcomer { id: string; fullName: string; address?: string | null; whatsapp?: string | null; phone?: string | null; email?: string | null; homeChurch?: string | null; invitedBy?: string | null; createdAt?: string | null }
const FIELDS = [["fullName", "Nom complet"], ["address", "Adresse"], ["phone", "Téléphone"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["homeChurch", "Église d'attache"], ["invitedBy", "Personne ayant invité"]] as const;
type Mode = null | "choose" | "pick" | { edit: Newcomer | null };
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function NewcomersTab() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canWrite = s.can("registry.write") && !s.consolidated;
  const [mode, setMode] = useState<Mode>(null);
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: useScopedKey("effectifs-newcomers"), queryFn: () => api.get<Newcomer[]>("/effectifs/newcomers") });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/effectifs/newcomers/${id}`), onSuccess: invalidate });
  const rows = useMemo(() => (list.data ?? []).filter((n) => !q || norm(FIELDS.map(([k]) => n[k] ?? "").join(" ")).includes(norm(q))), [list.data, q]);
  const spec = () => ({
    title: "Liste des nouveaux venus", columns: [...FIELDS.map(([key, header]) => ({ header, key })), { header: "Date", key: "date" }],
    rows: rows.map((n) => ({ ...n, date: fmtDate(n.createdAt) })),
  });
  const close = () => setMode(null);
  return (
    <>
      <Card title="Nouveaux venus" actions={<span className="flex flex-wrap items-center gap-2"><ExportButtons spec={spec} />{canWrite && <Button size="sm" onClick={() => setMode("choose")}><Plus /> Nouveau venu</Button>}</span>}>
        <div className="mb-3 relative max-w-sm"><Search className="absolute left-2 top-2 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Rechercher…" aria-label="Rechercher un nouveau venu" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ErrorNote error={del.error} />
        <DataTable<Newcomer> rows={rows} loading={list.isLoading} emptyIcon={Users} empty="Aucun nouveau venu enregistré" pageSize={25} columns={[
          ...FIELDS.map(([k, h]) => ({ header: h, cell: (n: Newcomer) => n[k] ?? "", sort: (n: Newcomer) => n[k] })),
          { header: "Date", cell: (n: Newcomer) => fmtDate(n.createdAt), sort: (n: Newcomer) => n.createdAt },
          { header: "", cell: (n) => canWrite && (
            <span className="actions">
              <Button size="sm" variant="outline" onClick={() => setMode({ edit: n })}><Pencil />Modifier</Button>
              <Button size="sm" variant="ghost" aria-label={`Supprimer ${n.fullName}`} onClick={() => confirm(`Supprimer ${n.fullName} ?`) && del.mutate(n.id)}><Trash2 /></Button>
            </span>) },
        ]} />
      </Card>
      <ModalForm open={mode === "choose"} onOpenChange={(o) => !o && close()} title="Nouveau venu" className="sm:max-w-md">
        <div className="grid gap-2">
          <Button onClick={() => setMode({ edit: null })}><UserPlus />Nouvelle fiche</Button>
          <Button variant="outline" onClick={() => setMode("pick")}><Search />Fiche existante</Button>
        </div>
      </ModalForm>
      <ModalForm open={mode === "pick"} onOpenChange={(o) => !o && close()} title="Nouveau venu existant" description="Recherchez puis choisissez la fiche à modifier." className="sm:max-w-md">
        <Picker newcomers={list.data ?? []} onPick={(n) => setMode({ edit: n })} />
      </ModalForm>
      <ModalForm open={typeof mode === "object" && mode !== null} onOpenChange={(o) => !o && close()} title={typeof mode === "object" && mode?.edit ? "Modifier la fiche" : "Nouveau venu"}>
        {typeof mode === "object" && mode && <NewcomerForm key={mode.edit?.id ?? "new"} newcomer={mode.edit} newcomers={list.data ?? []} onClose={close} />}
      </ModalForm>
    </>
  );
}

function Picker({ newcomers, onPick }: { newcomers: Newcomer[]; onPick: (n: Newcomer) => void }) {
  const [q, setQ] = useState("");
  const found = newcomers.filter((n) => norm(`${n.fullName} ${n.phone ?? ""} ${n.whatsapp ?? ""}`).includes(norm(q))).slice(0, 8);
  return (
    <div className="space-y-2">
      <Input autoFocus placeholder="Nom, téléphone…" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y rounded-md border">
        {found.map((n) => <li key={n.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(n)}>{n.fullName}<span className="ml-2 text-muted-foreground">{n.phone ?? n.whatsapp ?? ""}</span></button></li>)}
        {!found.length && <li className="px-3 py-2 text-sm text-muted-foreground">Aucun résultat</li>}
      </ul>
    </div>
  );
}

function NewcomerForm({ newcomer, newcomers, onClose }: { newcomer: Newcomer | null; newcomers: Newcomer[]; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, newcomer?.[k] ?? ""])));
  const [err, setErr] = useState("");
  const save = useMutation({ mutationFn: () => (newcomer ? api.put(`/effectifs/newcomers/${newcomer.id}`, v) : api.post("/effectifs/newcomers", v)), onSuccess: () => { invalidate(); onClose(); } });
  // "Personne ayant invité": pick an existing newcomer or member (not the record being edited); a name already stored stays selectable.
  const inviters = newcomers.filter((n) => n.id !== newcomer?.id).map((n) => n.fullName);
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

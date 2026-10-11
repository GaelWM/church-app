import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, ClipboardCheck, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { ASSET_ETATS, ASSET_ETAT_LABELS, INVENTORY_GAP_LABELS, lineGaps, type AssetEtat, type InventoryGap } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionButton, Banner, Card, DataTable, ErrorNote, ExportButtons, Field, FormFooter, FormGrid, ModalForm, StatCard, ToneBadge, type Column, type Tone } from "@/components/common";
import { FormSelect, OptionSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { fmtDate } from "../../core/format";
import { useInvalidateLedger } from "../../core/queries";
import { useSession } from "../../core/session";
import { EtatBadge } from "./badges";
import { fmtDateTime } from "./format";
import { useAssetRefs, useInventories, useInventory } from "./queries";
import type { Inventory, InventoryDetail, InventoryLine } from "./types";

const base = "/immobilisations/inventories";
const GAP_TONE: Record<InventoryGap, Tone> = { a_verifier: "muted", absent: "destructive", autre_localisation: "warning", etat_different: "warning", non_enregistre: "warning" };
const dataOf = (l: InventoryLine) => ({
  assetId: l.assetId, expectedLocationId: l.expectedLocationId, expectedEtat: l.expectedEtat, present: l.present, foundLocationId: l.foundLocationId, foundEtat: l.foundEtat,
});
const etatOptions = ASSET_ETATS.map((e) => ({ value: e, label: ASSET_ETAT_LABELS[e] }));

/** Inventaire physique: compare what the register says (théorique) with what is found on site (physique). */
export function AssetInventoryTab() {
  const [params, setParams] = useSearchParams();
  const id = params.get("inv");
  const open = (inv: string | null) => { const n = new URLSearchParams(params); if (inv) n.set("inv", inv); else n.delete("inv"); setParams(n, { replace: true }); };
  return id ? <InventoryView id={id} onBack={() => open(null)} /> : <InventoryList onOpen={open} />;
}

// ── List ─────────────────────────────────────────────────
function InventoryList({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useSession();
  const list = useInventories();
  const [creating, setCreating] = useState(false);
  const canWrite = s.can("asset.manage") && !s.consolidated;
  return (
    <>
      <Card title="Inventaires" actions={canWrite ? <Button size="sm" onClick={() => setCreating(true)}><Plus /> Nouvel inventaire</Button> : undefined}>
        <p className="text-sm text-muted-foreground">Un inventaire fige la liste des immobilisations validées, puis chaque bien est vérifié sur place : présence, localisation, état, responsable. Les écarts sont signalés ; l'inventaire ne modifie jamais le registre.</p>
        <ErrorNote error={list.error} />
        <DataTable<Inventory> rows={list.data ?? []} loading={list.isLoading} emptyIcon={ClipboardCheck} empty="Aucun inventaire" pageSize={20} columns={[
          { header: "Référence", cell: (i) => <button type="button" className="font-mono font-medium underline-offset-2 hover:underline" onClick={() => onOpen(i.id)}>{i.reference}</button> },
          { header: "Périmètre", cell: (i) => i.locationName ?? "Toutes les localisations" },
          { header: "Début", cell: (i) => fmtDate(i.startedOn) },
          { header: "Avancement", cell: (i) => `${i.checked} / ${i.total} vérifié(s)` },
          { header: "Absents", align: "right", cell: (i) => i.absents },
          { header: "Non enregistrés", align: "right", cell: (i) => i.extras },
          { header: "Statut", cell: (i) => <ToneBadge tone={i.status === "cloture" ? "success" : "warning"}>{i.status === "cloture" ? "Clôturé" : "En cours"}</ToneBadge> },
        ]} />
      </Card>
      <ModalForm open={creating} onOpenChange={setCreating} title="Nouvel inventaire" className="sm:max-w-md">
        {creating && <NewInventoryForm onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
      </ModalForm>
    </>
  );
}

function NewInventoryForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs();
  const { register, control, handleSubmit } = useForm<{ locationId: string; observations: string }>({ defaultValues: { locationId: "", observations: "" } });
  const create = useMutation({
    mutationFn: (v: { locationId: string; observations: string }) => api.post<{ id: string }>(base, { locationId: v.locationId || null, observations: v.observations.trim() || null }),
    onSuccess: (r) => { invalidate(); onCreated(r.id); },
  });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-3">
      <Field label="Périmètre"><FormSelect control={control} name="locationId" options={[{ value: "", label: "Toutes les localisations" }, ...(refs.data?.locations ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }))]} /></Field>
      <Field label="Observations (optionnel)"><Input {...register("observations")} /></Field>
      <p className="text-xs text-muted-foreground">Les immobilisations validées du périmètre sont figées à cet instant : ce sera la situation théorique.</p>
      <ErrorNote error={create.error} />
      <FormFooter pending={create.isPending} onCancel={onClose} submitLabel="Démarrer l'inventaire" />
    </form>
  );
}

// ── One inventory ────────────────────────────────────────
type Show = "all" | "todo" | "gaps";

function InventoryView({ id, onBack }: { id: string; onBack: () => void }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const q = useInventory(id);
  const [show, setShow] = useState<Show>("all");
  const [detail, setDetail] = useState<InventoryLine | null>(null);
  const [adding, setAdding] = useState(false);
  const inv = q.data;
  const editable = !!inv && inv.status === "en_cours" && s.can("asset.manage") && !s.consolidated;

  const mark = useMutation({
    mutationFn: ({ line, present }: { line: InventoryLine; present: boolean }) => api.put(`${base}/${id}/lines/${line.id}`, {
      // Re-confirming a line must not erase an écart already recorded: send back where and how it was found.
      present, foundLocationId: present ? line.foundLocationId : null, foundEtat: present ? line.foundEtat : null,
      responsible: line.responsible, observation: line.observation,
    }),
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({ mutationFn: (lineId: string) => api.del(`${base}/${id}/lines/${lineId}`), onSuccess: () => invalidate() });
  const close = useMutation({ mutationFn: () => api.post(`${base}/${id}/close`, {}), onSuccess: () => invalidate() });

  const rows = useMemo(() => (inv?.lines ?? []).filter((l) => {
    const g = lineGaps(dataOf(l));
    return show === "all" || (show === "todo" ? g.includes("a_verifier") : g.length > 0 && !g.includes("a_verifier"));
  }), [inv, show]);

  const presence = (l: InventoryLine) => (l.assetId === null ? <ToneBadge tone="warning">Trouvé</ToneBadge> : l.present === null ? <ToneBadge tone="muted">À vérifier</ToneBadge> : l.present ? <ToneBadge tone="success">Présent</ToneBadge> : <ToneBadge tone="destructive">Absent</ToneBadge>);
  const gaps = (l: InventoryLine) => lineGaps(dataOf(l));
  const columns: Column<InventoryLine>[] = [
    { header: "Code", cell: (l) => (l.assetId ? <Link to={`/immobilisations/${l.assetId}`} className="font-mono underline-offset-2 hover:underline">{l.expectedCode}</Link> : <span className="text-muted-foreground">—</span>) },
    { header: "Description", cell: (l) => l.expectedDescription ?? l.extraDescription },
    { header: "Localisation (théorique)", cell: (l) => l.expectedLocationName ?? "—" },
    { header: "État (théorique)", cell: (l) => (l.expectedEtat ? <EtatBadge etat={l.expectedEtat} /> : "—") },
    { header: "Présence", cell: presence },
    { header: "Localisation constatée", cell: (l) => l.foundLocationName ?? "—" },
    { header: "État constaté", cell: (l) => (l.foundEtat ? <EtatBadge etat={l.foundEtat as AssetEtat} /> : "—") },
    { header: "Responsable / service", cell: (l) => l.responsible ?? "—" },
    { header: "Vérifié le", cell: (l) => (l.checkedAt ? `${fmtDateTime(l.checkedAt)}${l.checkedByName ? ` · ${l.checkedByName}` : ""}` : "—") },
    { header: "Écart", cell: (l) => <span className="flex flex-col gap-0.5">{gaps(l).map((g) => <ToneBadge key={g} tone={GAP_TONE[g]}>{INVENTORY_GAP_LABELS[g]}</ToneBadge>)}</span> },
    { header: "Observations", cell: (l) => l.observation ?? "" },
    { header: "", cell: (l) => editable && (
      <span className="actions">
        {l.assetId ? (
          <>
            <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate({ line: l, present: true })}><Check />Présent</Button>
            <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate({ line: l, present: false })}><X />Absent</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" aria-label="Retirer ce bien" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}><Trash2 /></Button>
        )}
        {l.assetId && <Button size="icon-sm" variant="ghost" aria-label="Détails" onClick={() => setDetail(l)}><Pencil /></Button>}
      </span>
    ) },
  ];

  const spec = () => ({
    title: `Inventaire ${inv?.reference ?? ""} — ${s.parish?.name ?? ""}`,
    subtitle: [inv?.locationName ?? "Toutes les localisations", `Début ${fmtDate(inv?.startedOn)}`, inv?.status === "cloture" ? `Clôturé le ${fmtDate(inv.closedAt)}` : "En cours"].join(" · "),
    columns: [
      { header: "Code", key: "code" }, { header: "Description", key: "desc" }, { header: "Localisation théorique", key: "eloc" }, { header: "État théorique", key: "eetat" },
      { header: "Présence", key: "present" }, { header: "Localisation constatée", key: "floc" }, { header: "État constaté", key: "fetat" },
      { header: "Responsable / service", key: "resp" }, { header: "Date de vérification", key: "date" }, { header: "Écart", key: "gap" }, { header: "Observations", key: "obs" },
    ],
    rows: (inv?.lines ?? []).map((l) => ({
      code: l.expectedCode ?? "—", desc: l.expectedDescription ?? l.extraDescription ?? "", eloc: l.expectedLocationName ?? "", eetat: l.expectedEtat ? ASSET_ETAT_LABELS[l.expectedEtat] : "",
      present: l.assetId === null ? "Trouvé (non enregistré)" : l.present === null ? "" : l.present ? "Présent" : "Absent", floc: l.foundLocationName ?? "",
      fetat: l.foundEtat ? ASSET_ETAT_LABELS[l.foundEtat as AssetEtat] : "", resp: l.responsible ?? "", date: l.checkedAt ? fmtDateTime(l.checkedAt) : "",
      gap: lineGaps(dataOf(l)).map((g) => INVENTORY_GAP_LABELS[g]).join(", "), obs: l.observation ?? "",
    })),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (q.error || !inv) return <><ErrorNote error={q.error ?? new Error("Inventaire introuvable")} /><Button variant="outline" onClick={onBack}><ArrowLeft />Retour</Button></>;
  const sm = inv.summary;
  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={onBack}><ArrowLeft />Inventaires</Button>
      <Card title={`Inventaire ${inv.reference}`} actions={
        <span className="flex flex-wrap items-center gap-2">
          <ExportButtons spec={spec} />
          {editable && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus />Bien trouvé non enregistré</Button>}
          {editable && <ActionButton size="sm" icon={Lock} pending={close.isPending} onClick={() => confirm("Clôturer l'inventaire ? Il ne pourra plus être modifié.") && close.mutate()}>Clôturer</ActionButton>}
        </span>}>
        <p className="text-sm text-muted-foreground">
          {inv.locationName ?? "Toutes les localisations"} · début le {fmtDate(inv.startedOn)} ·{" "}
          {inv.status === "cloture" ? `clôturé le ${fmtDate(inv.closedAt)}` : "en cours"}{inv.observations ? ` · ${inv.observations}` : ""}
        </p>
        {inv.status === "cloture" && <Banner icon={Lock}>Inventaire clôturé : il est conservé tel quel. Pour un bien introuvable, déclarez-le « Perdu » depuis sa fiche.</Banner>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="À vérifier" value={sm.remaining} />
          <StatCard label="Vérifiés" value={`${sm.checked - sm.nonEnregistres} / ${sm.total - sm.nonEnregistres}`} />
          <StatCard label="Conformes" value={sm.conformes} />
          <StatCard label="Absents" value={sm.absents} />
          <StatCard label="Écarts de lieu / d'état" value={`${sm.autreLocalisation} / ${sm.etatDifferent}`} />
          <StatCard label="Non enregistrés" value={sm.nonEnregistres} />
        </div>
        <div className="flex items-end gap-3">
          <Field label="Afficher"><OptionSelect size="sm" className="w-auto min-w-44" value={show} onValueChange={(v) => setShow(v as Show)} options={[{ value: "all", label: "Tout" }, { value: "todo", label: "Reste à vérifier" }, { value: "gaps", label: "Écarts seulement" }]} /></Field>
        </div>
        <ErrorNote error={mark.error ?? remove.error ?? close.error} />
        <DataTable<InventoryLine> rows={rows} columns={columns} emptyIcon={ClipboardCheck} empty={show === "all" ? "Aucune ligne" : "Rien à afficher pour ce filtre"} pageSize={50} />
      </Card>
      <ModalForm open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={`Vérification de ${detail?.expectedCode ?? ""}`} description={detail?.expectedDescription ?? undefined} className="sm:max-w-lg">
        {detail && <LineForm inventory={inv} line={detail} onClose={() => setDetail(null)} />}
      </ModalForm>
      <ModalForm open={adding} onOpenChange={setAdding} title="Bien trouvé, non enregistré" description="Il reste sur l'inventaire comme écart ; il n'est pas ajouté au registre." className="sm:max-w-lg">
        {adding && <FoundForm inventory={inv} onClose={() => setAdding(false)} />}
      </ModalForm>
    </>
  );
}

// ── Dialogs ──────────────────────────────────────────────
const lineSchema = z.object({ present: z.enum(["oui", "non"]), foundLocationId: z.string(), foundEtat: z.string(), responsible: z.string(), observation: z.string() });
type LineValues = z.infer<typeof lineSchema>;

function LineForm({ inventory, line, onClose }: { inventory: InventoryDetail; line: InventoryLine; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs();
  const { register, control, watch, handleSubmit } = useForm<LineValues>({
    resolver: zodResolver(lineSchema),
    defaultValues: {
      present: line.present === false ? "non" : "oui", foundLocationId: line.foundLocationId ?? line.expectedLocationId ?? "", foundEtat: line.foundEtat ?? line.expectedEtat ?? "bon",
      responsible: line.responsible ?? "", observation: line.observation ?? "",
    },
  });
  const present = watch("present") === "oui";
  const save = useMutation({
    mutationFn: (v: LineValues) => api.put(`${base}/${inventory.id}/lines/${line.id}`, {
      present: v.present === "oui", foundLocationId: v.present === "oui" ? v.foundLocationId || null : null, foundEtat: v.present === "oui" ? v.foundEtat : null,
      responsible: v.responsible.trim() || null, observation: v.observation.trim() || null,
    }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3">
      <FormGrid>
        <Field label="Présence physique"><FormSelect control={control} name="present" options={[{ value: "oui", label: "Présent" }, { value: "non", label: "Absent" }]} /></Field>
        <div />
        {present && <Field label="Localisation constatée"><FormSelect control={control} name="foundLocationId" options={(refs.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>}
        {present && <Field label="État constaté"><FormSelect control={control} name="foundEtat" options={etatOptions} /></Field>}
        <div className="col-span-full"><Field label="Responsable / service"><Input {...register("responsible")} /></Field></div>
        <div className="col-span-full"><Field label="Observations"><Input {...register("observation")} /></Field></div>
      </FormGrid>
      {!present && <p className="text-xs text-muted-foreground">Un bien introuvable n'est pas modifié ici : déclarez-le « Perdu » depuis sa fiche, avec l'approbation du Trésorier et du Pasteur.</p>}
      <ErrorNote error={save.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

const foundSchema = z.object({ description: z.string().trim().min(1, "Description requise"), foundLocationId: z.string().min(1, "Localisation requise"), foundEtat: z.string(), responsible: z.string(), observation: z.string() });
type FoundValues = z.infer<typeof foundSchema>;

function FoundForm({ inventory, onClose }: { inventory: InventoryDetail; onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs();
  const { register, control, handleSubmit, formState: { errors } } = useForm<FoundValues>({
    resolver: zodResolver(foundSchema), defaultValues: { description: "", foundLocationId: inventory.locationId ?? "", foundEtat: "bon", responsible: "", observation: "" },
  });
  const save = useMutation({
    mutationFn: (v: FoundValues) => api.post(`${base}/${inventory.id}/lines`, {
      description: v.description.trim(), foundLocationId: v.foundLocationId, foundEtat: v.foundEtat, responsible: v.responsible.trim() || null, observation: v.observation.trim() || null,
    }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-3">
      <FormGrid>
        <div className="col-span-full"><Field label="Description" error={errors.description?.message}><Input autoFocus {...register("description")} /></Field></div>
        <Field label="Localisation" error={errors.foundLocationId?.message}><FormSelect control={control} name="foundLocationId" placeholder="Où l'avez-vous trouvé ?" options={(refs.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <Field label="État"><FormSelect control={control} name="foundEtat" options={etatOptions} /></Field>
        <div className="col-span-full"><Field label="Responsable / service"><Input {...register("responsible")} /></Field></div>
        <div className="col-span-full"><Field label="Observations"><Input {...register("observation")} /></Field></div>
      </FormGrid>
      <ErrorNote error={save.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

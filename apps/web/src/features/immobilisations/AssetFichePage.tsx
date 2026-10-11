import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Ban, FilePenLine, History, Pencil, Printer, QrCode, Send, Trash2, Undo2, Repeat } from "lucide-react";
import {
  ASSET_FIELD_LABELS, accountDisplay, ASSET_STATUT_LABELS, DEPRECIATION_METHOD_LABELS, ASSET_ETAT_LABELS, subaccountDisplay, ASSET_ACCOUNT_LABELS, type AssetStatut,
} from "@church/shared";
import { Button } from "@/components/ui/button";
import { ActionButton, Banner, Card, DataTable, ErrorNote, ExportButtons, ModalForm, PageHeader, ReasonDialog } from "@/components/common";
import { Timeline } from "@/components/Timeline";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useInvalidateLedger } from "../../core/queries";
import { FileUploader } from "../registres/FileUploader";
import { useSession } from "../../core/session";
import { AssetForm } from "./AssetForm";
import { AssetRequestDialog } from "./AssetRequestDialog";
import { AssetRequestsPanel } from "./AssetRequestsPanel";
import { AssetStatutBadge, EtatBadge } from "./badges";
import { EtatChangeDialog } from "./EtatChangeDialog";
import { EtatHistoryDialog } from "./EtatHistoryDialog";
import { fmtDateTime, formatRequestValue } from "./format";
import { LabelPrintDialog } from "./labels/LabelPrintDialog";
import { useAsset, useAssetAudit, useAssetRefs } from "./queries";
import type { AssetDetail, AssetRefs, AuditEntry, ScheduleRow } from "./types";

const pct = (r: number | null) => (r == null ? "—" : `${String(r).replace(".", ",")} %`);

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}
const Grid = ({ children }: { children: ReactNode }) => <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;

const AUDIT_LABELS: Record<string, string> = {
  "asset.create": "Brouillon créé", "asset.update_draft": "Brouillon modifié", "asset.delete_draft": "Brouillon supprimé", "asset.discard": "Brouillon abandonné",
  "asset.submit": "Soumis pour validation", "asset.rejected": "Refusé : retour en brouillon", "asset.activate": "Validé : immobilisation active",
  "asset.request.create": "Demande créée", "asset.request.approve1": "Approuvé par le Trésorier", "asset.request.approve2": "Approuvé par le Pasteur",
  "asset.request.reject": "Demande refusée", "asset.request.execute": "Demande exécutée", "asset.modify": "Modification appliquée",
  "asset.code_change": "Changement exceptionnel du code", "asset.cancel": "Annulation", "asset.etat_change": "Changement d'état",
  "asset.print": "Impression", "asset.reprint": "Réimpression", "asset.export": "Export de la fiche",
  "asset.file.add": "Pièce jointe ajoutée", "asset.file.delete": "Pièce jointe supprimée",
};

type Sig = { name?: string | null; at?: string | null; nonRequis?: string };
const sig = (label: string, s?: Sig) => (s?.name ? `${label} : ${s.name}${s.at ? ` (${fmtDateTime(s.at)})` : ""}` : s?.nonRequis ? `${label} : non requis (${s.nonRequis})` : null);

/** The facts that matter in an audit line: old → new values, motif, comment, and who approved when. */
function auditDetail(e: AuditEntry, refs: AssetRefs | undefined, currency: string): ReactNode {
  const a = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  // Fields present on both sides are a change: show "ancienne valeur → nouvelle valeur".
  // Only what actually changed (a draft edit stores the whole row on both sides), in the currency each value was stated in.
  const oldCur = String(before.currency ?? currency), newCur = String(a.currency ?? before.currency ?? currency);
  const changes = Object.keys(before).filter((k) => k in ASSET_FIELD_LABELS && k in a && JSON.stringify(before[k]) !== JSON.stringify(a[k]))
    .map((k) => `${ASSET_FIELD_LABELS[k]} : ${formatRequestValue(k, before[k], refs, oldCur)} → ${formatRequestValue(k, a[k], refs, newCur)}`);
  const lines = [
    ...changes,
    typeof a.reason === "string" && a.reason ? `Motif : ${a.reason}` : null,
    typeof a.comment === "string" && a.comment ? `Commentaire : ${a.comment}` : null,
    typeof a.request === "string" ? `Demande ${a.request}` : null,
    sig("Trésorier", a.tresorier as Sig | undefined), sig("Pasteur", a.pasteur as Sig | undefined),
    typeof a.niveauTresorier === "string" ? `Niveau Trésorier ${a.niveauTresorier}` : null,
    typeof a.niveauPasteur === "string" ? `Niveau Pasteur ${a.niveauPasteur}` : null,
  ].filter(Boolean) as string[];
  return lines.length ? <div className="space-y-0.5 text-xs">{lines.map((l) => <div key={l}>{l}</div>)}</div> : undefined;
}

const scheduleColumns = (currency: string) => [
  { header: "Année", cell: (r: ScheduleRow) => r.fiscalYear },
  { header: "Mois", align: "right" as const, cell: (r: ScheduleRow) => r.months },
  { header: "Annuité", align: "right" as const, cell: (r: ScheduleRow) => money(r.annuityMinor, currency) },
  { header: "Amortissement cumulé", align: "right" as const, cell: (r: ScheduleRow) => money(r.accumulatedMinor, currency) },
  { header: "VNC", align: "right" as const, cell: (r: ScheduleRow) => money(r.vncMinor, currency) },
];

/** Fiche d'une immobilisation: what it is, where it is, what it cost, how it is depreciated, how its état evolved, and who approved what. */
export function AssetFichePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const asset = useAsset(id);
  const audit = useAssetAudit(id);
  const refs = useAssetRefs(true);
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [history, setHistory] = useState(false);
  const [etat, setEtat] = useState(false);
  const [request, setRequest] = useState<"modification" | "annulation" | null>(null);
  const [printing, setPrinting] = useState<"etiquette" | "code" | null>(null);
  const canWrite = s.can("asset.manage") && !s.consolidated;

  const submit = useMutation({ mutationFn: () => api.post(`/immobilisations/${id}/submit`, {}), onSuccess: () => invalidate() });
  const discard = useMutation({ mutationFn: (reason: string) => api.post(`/immobilisations/${id}/discard`, { reason }), onSuccess: () => invalidate() });
  const remove = useMutation({ mutationFn: () => api.del(`/immobilisations/${id}`), onSuccess: () => { invalidate(); navigate("/immobilisations"); } });

  if (asset.isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (asset.error || !asset.data) return (
    <>
      <PageHeader title="Immobilisation" />
      <ErrorNote error={asset.error ?? new Error("Immobilisation introuvable")} />
      <Button asChild variant="outline" className="mt-3"><Link to="/immobilisations"><ArrowLeft />Retour au registre</Link></Button>
    </>
  );
  const a: AssetDetail = asset.data;
  const cur = a.currency;
  const m = (minor: string) => money(minor, cur);
  const draft = a.statut === "brouillon";
  const active = a.statut === "actif";
  const busy = !!a.openRequest;
  // A document printed before is "réimprimé": the trail already holds the first print of that kind.
  const printedBefore = (kind: "etiquette" | "code") => (audit.data ?? []).some((e) => e.action === "asset.print" && (e.after as { kind?: string } | null)?.kind === kind);

  const exportSpec = () => ({
    title: `Fiche immobilisation ${a.code}`, subtitle: `${a.description} — ${s.parish?.name ?? ""}`,
    columns: [{ header: "Rubrique", key: "k" }, { header: "Valeur", key: "v" }],
    rows: [
      ["Code", a.code], ["Type de compte", accountDisplay(a.accountCode)], ["Sous-compte", subaccountDisplay(a.subaccountCode)], ["Description", a.description],
      ["N° de facture", a.invoiceNumber ?? ""], ["Fournisseur", a.supplierName ?? ""], ["Localisation", a.locationName],
      ["Date d'acquisition", fmtDate(a.acquisitionDate)], ["Date de mise en service", fmtDate(a.inServiceDate)], ["Devise", cur],
      ["Taux de change (1 USD =)", a.fxRatePerUsd ?? ""], ["PA — Prix d'achat", m(a.paMinor)], ["FAA — Frais accessoires", m(a.faaMinor)],
      ["Coût d'acquisition", m(a.costMinor)], ["Mode d'amortissement", DEPRECIATION_METHOD_LABELS[a.depreciationMethod]],
      ["Durée", a.usefulLifeYears ? `${a.usefulLifeYears} ans` : ""], ["Taux", a.rate == null ? "" : pct(a.rate)],
      ["Valeur amortissable", m(a.depreciableMinor)], ["Amortissement de l'exercice", m(a.exerciseMinor)], ["Amortissement cumulé", m(a.accumulatedMinor)],
      ["VNC", m(a.vncMinor)], ["État", ASSET_ETAT_LABELS[a.etat]], ["Statut", ASSET_STATUT_LABELS[a.displayStatut as AssetStatut]], ["Observations", a.observations ?? ""],
    ].map(([k, v]) => ({ k, v })),
  });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2"><Link to="/immobilisations"><ArrowLeft />Registre des immobilisations</Link></Button>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{a.code}</span><span className="text-lg font-normal text-muted-foreground">{a.description}</span></span>}>
        <span className="flex items-center gap-4"><AssetStatutBadge statut={a.displayStatut} /><EtatBadge etat={a.etat} /></span>
      </PageHeader>

      {draft && <Banner>Brouillon : cette immobilisation n'est pas encore validée. Soumettez-la pour que le Trésorier puis le Pasteur la valident.</Banner>}
      {a.statut === "en_attente_validation" && <Banner>En attente de validation : elle ne peut plus être modifiée tant que la décision n'est pas prise.</Banner>}
      {active && a.openRequest && <Banner>Une demande est en cours ({a.openRequest.reference}). L'immobilisation reste inchangée jusqu'à la décision du Trésorier et du Pasteur.</Banner>}
      {a.statut === "annule" && <Banner>Annulée : l'enregistrement est conservé avec son historique.</Banner>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canWrite && draft && (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil />Modifier</Button>
            <ActionButton size="sm" icon={Send} pending={submit.isPending} onClick={() => submit.mutate()}>Soumettre pour validation</ActionButton>
            <Button size="sm" variant="outline" onClick={() => setDiscarding(true)}><Undo2 />Abandonner</Button>
            <ActionButton size="sm" variant="ghost" icon={Trash2} pending={remove.isPending} onClick={() => confirm(`Supprimer le brouillon ${a.code} ? Cette action est définitive.`) && remove.mutate()}>Supprimer</ActionButton>
          </>
        )}
        {canWrite && active && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRequest("modification")}><FilePenLine />Demander une modification</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRequest("annulation")}><Ban />Demander une annulation</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEtat(true)}><Repeat />Changer l'état</Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => setHistory(true)}><History />Historique de l'état</Button>
        {active && !s.consolidated && (
          <>
            <Button size="sm" variant="outline" onClick={() => setPrinting("code")}><Printer />{printedBefore("code") ? "Réimprimer le code" : "Imprimer le code"}</Button>
            <Button size="sm" variant="outline" onClick={() => setPrinting("etiquette")}><QrCode />{printedBefore("etiquette") ? "Réimprimer l'étiquette" : "Imprimer l'étiquette"}</Button>
          </>
        )}
        <ExportButtons spec={exportSpec} />
      </div>
      <ErrorNote error={submit.error ?? discard.error ?? remove.error} />

      <Card title="Identification">
        <Grid>
          <Item label="Code immobilisation"><span className="font-mono">{a.code}</span></Item>
          <Item label="Type de compte">{a.accountCode} — {ASSET_ACCOUNT_LABELS[a.accountCode as keyof typeof ASSET_ACCOUNT_LABELS]}</Item>
          <Item label="Sous-compte">{subaccountDisplay(a.subaccountCode)}</Item>
          <Item label="Description">{a.description}</Item>
          <Item label="N° de facture">{a.invoiceNumber}</Item>
          <Item label="Fournisseur">{a.supplierName}</Item>
          <Item label="Date d'acquisition">{fmtDate(a.acquisitionDate)}</Item>
          <Item label="Date de mise en service">{fmtDate(a.inServiceDate)}</Item>
          <Item label="Localisation">{a.locationName}</Item>
          <Item label="Devise">{cur}{a.fxRatePerUsd ? ` · 1 USD = ${a.fxRatePerUsd} ${cur}` : ""}</Item>
          <Item label="Statut"><AssetStatutBadge statut={a.displayStatut} /></Item>
          <Item label="État"><EtatBadge etat={a.etat} /></Item>
          <Item label="Enregistrée le">{fmtDate(a.registeredAt)}</Item>
          <div className="sm:col-span-2 lg:col-span-3"><Item label="Observations">{a.observations}</Item></div>
        </Grid>
      </Card>

      <Card title="Coût d'acquisition">
        <Grid>
          <Item label="PA — Prix d'achat">{m(a.paMinor)}</Item>
          <Item label="FAA — Frais accessoires d'achat">{m(a.faaMinor)}</Item>
          <Item label="Coût d'acquisition (PA + FAA)"><b>{m(a.costMinor)}</b></Item>
        </Grid>
      </Card>

      <Card title="Amortissement">
        <Grid>
          <Item label="Mode d'amortissement">{DEPRECIATION_METHOD_LABELS[a.depreciationMethod]}{a.degressiveCoefficient ? ` (coefficient ${a.degressiveCoefficient})` : ""}</Item>
          <Item label="Durée d'amortissement">{a.usefulLifeYears ? `${a.usefulLifeYears} ans` : "Non amortissable"}</Item>
          <Item label="Taux">{pct(a.rate)}</Item>
          <Item label="Valeur amortissable">{m(a.depreciableMinor)}</Item>
          <Item label="Amortissement de l'exercice">{m(a.exerciseMinor)}</Item>
          <Item label="Amortissement cumulé">{m(a.accumulatedMinor)}</Item>
          <Item label="Valeur nette comptable (VNC)"><b>{m(a.vncMinor)}</b></Item>
        </Grid>
        {a.schedule.length > 0 && <DataTable<ScheduleRow & { id?: string }> rows={a.schedule.map((r) => ({ ...r, id: String(r.fiscalYear) }))} columns={scheduleColumns(cur)} />}
        <p className="text-xs text-muted-foreground">Calculs jusqu'à la fin du mois en cours, au prorata de la date de mise en service. Aucune écriture comptable n'est générée.</p>
      </Card>

      <Card title="Pièces jointes">
        <FileUploader type="asset" recordId={a.id} label="Photos, factures, documents" canWrite={canWrite && a.statut !== "annule"}
          listPath={`/immobilisations/${a.id}/files`} filePath="/immobilisations/files" />
      </Card>

      <Section title="Demandes">
        <AssetRequestsPanel assetId={a.id} />
      </Section>

      <Card title="Piste d'audit">
        <ErrorNote error={audit.error} />
        <Timeline empty="Aucune action enregistrée" items={(audit.data ?? []).map((e) => ({
          id: e.id, at: fmtDateTime(e.at), by: e.actorName ?? undefined, title: AUDIT_LABELS[e.action] ?? e.action, detail: auditDetail(e, refs.data, cur),
          tone: e.action === "asset.request.reject" || e.action === "asset.cancel" ? "destructive" : e.action === "asset.activate" ? "success" : undefined,
        }))} />
      </Card>

      <ModalForm open={editing} onOpenChange={setEditing} title={`Modifier le brouillon ${a.code}`} className="sm:max-w-3xl">
        {editing && <AssetForm asset={a} onClose={() => setEditing(false)} />}
      </ModalForm>
      <ReasonDialog open={discarding} onOpenChange={setDiscarding} title={`Abandonner ${a.code}`} label="Motif de l'abandon" confirmLabel="Abandonner" destructive onConfirm={(r) => discard.mutate(r)} />
      <EtatHistoryDialog asset={a} open={history} onOpenChange={setHistory} />
      {etat && <EtatChangeDialog asset={a} open={etat} onOpenChange={setEtat} />}
      {printing && (
        <LabelPrintDialog open variant={printing} reprint={printedBefore(printing)} onOpenChange={(o) => !o && setPrinting(null)}
          items={[{ id: a.id, code: a.code, description: a.description, locationName: a.locationName }]} />
      )}
      {request && <AssetRequestDialog asset={a} kind={request} open onOpenChange={(o) => !o && setRequest(null)} />}
    </>
  );
}

/** Ungrouped block with a heading, for the requests list (it brings its own card). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mb-4"><h2 className="mb-2 text-base font-semibold">{title}</h2>{children}</section>;
}

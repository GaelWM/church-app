import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, FileClock, X } from "lucide-react";
import { CHANGE_REQUEST_STATUS_LABELS, type ChangeRequestStatus, type Currency } from "@church/shared";
import { ActionButton, Card, DataTable, ErrorNote, ReasonDialog } from "@/components/common";
import { useApi } from "../../core/api";
import { money } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";

interface ChangeRequest {
  id: string; reference: string; kind: "modification" | "annulation"; reason: string; status: ChangeRequestStatus;
  transactionId: string; txReference: string; txDescription?: string | null; txAmountMinor: string; txCurrency: Currency;
  proposedChanges?: Record<string, unknown> | null; oldValues?: Record<string, unknown> | null; rejectedReason?: string | null;
  requesterId: string; requesterName: string; tresorierName?: string | null; tresorierAt?: string | null;
  pasteurName?: string | null; pasteurAt?: string | null; executedAt?: string | null; createdAt: string;
}
interface CrEvent { id: string; toStatus: ChangeRequestStatus; actorName: string; at: string; comment?: string | null }

const fmtDateTime = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");
const FIELD_LABELS: Record<string, string> = { description: "Libellé", beneficiary: "Bénéficiaire", documentNumber: "N° pièce", subCategory: "Sous-catégorie", categoryId: "Catégorie", departmentId: "Département" };

function ChangeDetail({ r }: { r: ChangeRequest }) {
  const api = useApi();
  const ev = useQuery({ queryKey: useScopedKey("change-request", r.id), queryFn: () => api.get<{ events: CrEvent[] }>(`/change-requests/${r.id}`) });
  return (
    <div className="bg-muted/40 space-y-2 rounded-md p-3 text-xs">
      <p><b>Motif :</b> {r.reason}</p>
      {r.kind === "modification" && r.proposedChanges && Object.keys(r.proposedChanges).map((k) => (
        <p key={k}><b>{FIELD_LABELS[k] ?? k} :</b> <s>{String(r.oldValues?.[k] ?? "—")}</s> → {String(r.proposedChanges![k] ?? "—")}</p>
      ))}
      {r.rejectedReason && <p><b>Motif du rejet :</b> {r.rejectedReason}</p>}
      <ol className="space-y-0.5">
        {(ev.data?.events ?? []).map((e) => (
          <li key={e.id}>{fmtDateTime(e.at)} · {CHANGE_REQUEST_STATUS_LABELS[e.toStatus]} · {e.actorName}{e.comment && e.toStatus !== "en_attente_tresorier" ? ` — ${e.comment}` : ""}</li>
        ))}
      </ol>
    </div>
  );
}

/** §27: requests to modify/cancel validated entries. Trésorier approves first, Pasteur last; the history stays visible to everyone with read access. */
export function ChangeRequestsPanel() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const [open, setOpen] = useState(new Set<string>());
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null);
  const list = useQuery({ queryKey: useScopedKey("change-requests"), queryFn: () => api.get<ChangeRequest[]>("/change-requests") });
  const act = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: string; comment?: string }) => api.post(`/change-requests/${id}/${action}`, { comment }),
    onSuccess: () => invalidate(),
  });
  const mine = (r: ChangeRequest) => r.requesterId === s.me.user.id;
  const actionFor = (r: ChangeRequest) =>
    mine(r) ? null
      : r.status === "en_attente_tresorier" && s.can("transaction.validate1") ? "approve1"
      : r.status === "approuvee_n1" && s.can("transaction.validate2") ? "approve2" : null;
  const rows = list.data ?? [];
  const todo = rows.filter((r) => actionFor(r));
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <ErrorNote error={act.error} />
      <Card title={`${todo.length} demande(s) à traiter · ${rows.length} au total`}>
        <DataTable<ChangeRequest>
          rows={rows} loading={list.isLoading} emptyIcon={FileClock} empty="Aucune demande de modification / annulation"
          columns={[
            { header: "", cell: (r) => <button type="button" aria-label="Historique" onClick={() => toggle(r.id)}>{open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button> },
            { header: "Réf.", cell: (r) => r.reference },
            { header: "Écriture", cell: (r) => `${r.txReference} · ${money(r.txAmountMinor, r.txCurrency)}` },
            { header: "Type", cell: (r) => (r.kind === "annulation" ? "Annulation" : "Modification") },
            { header: "Demandeur", cell: (r) => r.requesterName },
            { header: "Trésorier", cell: (r) => (r.tresorierName ? `${r.tresorierName} · ${fmtDateTime(r.tresorierAt)}` : "") },
            { header: "Pasteur", cell: (r) => (r.pasteurName ? `${r.pasteurName} · ${fmtDateTime(r.pasteurAt)}` : "") },
            { header: "Statut", cell: (r) => <span className="text-xs font-medium whitespace-nowrap">{CHANGE_REQUEST_STATUS_LABELS[r.status]}</span> },
            { header: "", cell: (r) => (
              <div className="space-y-2">
                {actionFor(r) && (
                  <span className="inline-flex gap-1.5">
                    <ActionButton size="sm" icon={Check} pending={act.isPending && act.variables?.id === r.id} onClick={() => act.mutate({ id: r.id, action: actionFor(r)! })}>Approuver</ActionButton>
                    <ActionButton size="sm" variant="destructive" icon={X} disabled={act.isPending} onClick={() => setRejecting(r)}>Rejeter</ActionButton>
                  </span>
                )}
                {open.has(r.id) && <ChangeDetail r={r} />}
              </div>
            ) },
          ]}
        />
      </Card>
      <ReasonDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title={`Rejeter ${rejecting?.reference ?? ""}`} label="Motif du rejet" confirmLabel="Rejeter" destructive
        onConfirm={(comment) => { if (rejecting) act.mutate({ id: rejecting.id, action: "reject", comment }); setRejecting(null); }} />
    </>
  );
}

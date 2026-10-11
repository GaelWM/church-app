import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, FileClock, X } from "lucide-react";
import { ASSET_FIELD_LABELS, ASSET_REQUEST_KIND_LABELS, nextApprovalAction } from "@church/shared";
import { ActionButton, Card, DataTable, ErrorNote, ReasonDialog } from "@/components/common";
import { Timeline } from "@/components/Timeline";
import { useApi } from "../../core/api";
import { useInvalidateLedger } from "../../core/queries";
import { useSession } from "../../core/session";
import { RequestStatusBadge } from "./badges";
import { fmtDateTime, formatRequestValue } from "./format";
import { useAssetRefs, useAssetRequest, useAssetRequests } from "./queries";
import type { AssetRequest } from "./types";

function RequestDetail({ r }: { r: AssetRequest }) {
  const refs = useAssetRefs(true);
  const detail = useAssetRequest(r.id, true);
  // Amounts are in the currency they were stated in: the new one when the request also changes the currency.
  const newCur = String(r.proposedChanges?.currency ?? r.assetCurrency), oldCur = String(r.oldValues?.currency ?? r.assetCurrency);
  const val = (field: string, v: unknown, cur = newCur) => formatRequestValue(field, v, refs.data, cur);
  const changes = Object.entries(r.proposedChanges ?? {});
  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
      <p><b>Motif :</b> {r.reason}</p>
      {changes.length > 0 && (
        <ul className="space-y-0.5">
          {changes.map(([k, v]) => (
            <li key={k}><b>{ASSET_FIELD_LABELS[k] ?? k} :</b>{" "}
              {r.oldValues && k in r.oldValues && <><s className="text-muted-foreground">{val(k, r.oldValues[k], oldCur)}</s> → </>}{val(k, v)}</li>
          ))}
        </ul>
      )}
      {r.n1Skipped && <p className="text-xs text-muted-foreground">Niveau Trésorier non requis : le demandeur est Trésorier.</p>}
      {r.n2Skipped && <p className="text-xs text-muted-foreground">Niveau Pasteur non requis : le demandeur est Pasteur.</p>}
      {r.rejectedReason && <p><b>Motif du refus :</b> {r.rejectedReason}</p>}
      <Timeline items={(detail.data?.events ?? []).map((e) => ({
        id: e.id, at: fmtDateTime(e.at), by: e.actorName, title: <RequestStatusBadge status={e.toStatus} />,
        tone: e.toStatus === "rejetee" ? "destructive" : e.toStatus === "executee" ? "success" : undefined,
        detail: e.comment && e.toStatus !== "en_attente_tresorier" ? e.comment : undefined,
      }))} />
    </div>
  );
}

/**
 * Requests on assets: creation to validate, modifications, annulations and sensitive état changes. The Trésorier approves
 * first and the Pasteur last; the requester never approves their own request. `assetId` narrows it to one asset.
 */
export function AssetRequestsPanel({ assetId }: { assetId?: string }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const [open, setOpen] = useState(new Set<string>());
  const [rejecting, setRejecting] = useState<AssetRequest | null>(null);
  const list = useAssetRequests({ assetId });
  const act = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: string; comment?: string }) => api.post(`/immobilisations/requests/${id}/${action}`, { comment }),
    onSuccess: () => invalidate(),
  });
  // The consolidated view is read-only: the API refuses every write there.
  const actionFor = (r: AssetRequest) => s.consolidated ? null : nextApprovalAction({ status: r.status, roles: s.roles, userId: s.me.user.id, requesterId: r.requesterId });
  const rows = list.data ?? [];
  const todo = rows.filter((r) => actionFor(r));
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <ErrorNote error={act.error} />
      <Card title={`${todo.length} demande(s) à traiter · ${rows.length} au total`}>
        <DataTable<AssetRequest>
          rows={rows} loading={list.isLoading} emptyIcon={FileClock} empty="Aucune demande sur les immobilisations" pageSize={25}
          columns={[
            { header: "", cell: (r) => <button type="button" aria-label="Détail" onClick={() => toggle(r.id)}>{open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button> },
            { header: "Réf.", cell: (r) => r.reference },
            { header: "Immobilisation", cell: (r) => <Link to={`/immobilisations/${r.assetId}`} className="underline-offset-2 hover:underline"><span className="font-mono">{r.assetCode}</span> · {r.assetDescription}</Link> },
            { header: "Type", cell: (r) => ASSET_REQUEST_KIND_LABELS[r.kind] },
            { header: "Demandeur", cell: (r) => r.requesterName },
            { header: "Date", cell: (r) => fmtDateTime(r.createdAt) },
            { header: "Statut", cell: (r) => <RequestStatusBadge status={r.status} /> },
            { header: "", cell: (r) => (
              <div className="space-y-2">
                {actionFor(r) && (
                  <span className="inline-flex gap-1.5">
                    <ActionButton size="sm" icon={Check} pending={act.isPending && act.variables?.id === r.id} onClick={() => act.mutate({ id: r.id, action: actionFor(r)! })}>Approuver</ActionButton>
                    <ActionButton size="sm" variant="destructive" icon={X} disabled={act.isPending} onClick={() => setRejecting(r)}>Refuser</ActionButton>
                  </span>
                )}
                {open.has(r.id) && <RequestDetail r={r} />}
              </div>
            ) },
          ]}
        />
      </Card>
      <ReasonDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title={`Refuser ${rejecting?.reference ?? ""}`} label="Motif du refus" confirmLabel="Refuser" destructive
        onConfirm={(comment) => { if (rejecting) act.mutate({ id: rejecting.id, action: "reject", comment }); setRejecting(null); }} />
    </>
  );
}

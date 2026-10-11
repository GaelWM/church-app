import { ASSET_ETAT_LABELS, type AssetEtat } from "@church/shared";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorNote } from "@/components/common";
import { Timeline, type TimelineItem } from "@/components/Timeline";
import { EtatBadge } from "./badges";
import { fmtDateTime } from "./format";
import { useEtatHistory } from "./queries";
import type { Asset, EtatHistoryEntry } from "./types";

const VALIDATION_LABEL: Record<EtatHistoryEntry["validation"], string> = {
  non_requis: "Sans validation", approuve: "Approuvé par le Trésorier et le Pasteur", en_attente: "En attente de validation", refuse: "Refusé",
};

const labelOf = (e: AssetEtat | null) => (e ? ASSET_ETAT_LABELS[e] : "—");

/** "Historique de l'état": every change since the acquisition (date, heure, ancien → nouvel état, motif, localisation, utilisateur, validation). */
export function EtatHistoryDialog({ asset, open, onOpenChange }: { asset: Asset; open: boolean; onOpenChange: (o: boolean) => void }) {
  const history = useEtatHistory(asset.id, open);
  const items: TimelineItem[] = (history.data ?? []).map((h) => ({
    id: h.id, at: fmtDateTime(h.at), by: h.actorName,
    tone: h.validation === "refuse" ? "destructive" : h.validation === "en_attente" ? "warning" : undefined,
    title: <span className="inline-flex flex-wrap items-center gap-1.5">{labelOf(h.oldEtat)} → <EtatBadge etat={h.newEtat} /></span>,
    detail: (
      <div className="space-y-0.5">
        <div><b>Motif :</b> {h.reason}</div>
        {h.observation && <div><b>Observations :</b> {h.observation}</div>}
        <div><b>Localisation :</b> {h.locationName}</div>
        <div className="text-xs text-muted-foreground">{VALIDATION_LABEL[h.validation]}{h.requestReference ? ` · ${h.requestReference}` : ""}{h.rejectedReason ? ` · ${h.rejectedReason}` : ""}</div>
      </div>
    ),
  }));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Historique de l'état</SheetTitle>
          <SheetDescription><span className="font-mono">{asset.code}</span> · {asset.description} — conservé en permanence, il ne peut pas être supprimé.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <ErrorNote error={history.error} />
          {history.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : <Timeline items={items} empty="Aucun changement d'état enregistré" />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

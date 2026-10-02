import { useSearchParams } from "react-router-dom";
import { TrendingDown } from "lucide-react";
import { DEPRECIATION_METHOD_LABELS, straightLineSchedule, type DepreciationYear } from "@church/shared";
import { Card, DataTable, EmptyState, Money, type Column } from "@/components/common";
import { OptionSelect } from "@/components/form-controls";
import { useAssets } from "./AssetListTab";

const yearOf = (iso: string) => Number(iso.slice(0, 4));

export function DepreciationTab() {
  const [params, setParams] = useSearchParams();
  const list = useAssets();
  const assets = list.data ?? [];
  const id = params.get("id") ?? "";
  const asset = assets.find((a) => a.id === id);
  const options = [{ value: "", label: "— Choisir une immobilisation —" }, ...assets.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))];
  const schedule: DepreciationYear[] = asset ? straightLineSchedule(BigInt(asset.amountMinor), asset.usefulLifeYears, yearOf(asset.acquisitionDate)) : [];
  const currentYear = new Date().getFullYear();
  const currentRow = schedule.find((r) => r.fiscalYear === currentYear) ?? schedule[0];

  const rows = schedule.map((r) => ({ ...r, id: String(r.index) }));
  const columns: Column<DepreciationYear & { id: string }>[] = [
    { header: "Année", cell: (r) => <span className={r.fiscalYear === currentYear ? "font-semibold" : undefined}>{r.index}</span> },
    { header: "Exercice", cell: (r) => (
      <span className={r.fiscalYear === currentYear ? "font-semibold text-primary" : undefined}>
        {r.fiscalYear}{r.fiscalYear === currentYear && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.7em] align-middle">en cours</span>}
      </span>
    ) },
    { header: "Annuité", align: "right", cell: (r) => <Money value={r.annuityMinor} currency={asset!.currency} /> },
    { header: "Cumul", align: "right", cell: (r) => <Money value={r.accumulatedMinor} currency={asset!.currency} /> },
    { header: "VNC", align: "right", cell: (r) => <Money value={r.netBookValueMinor} currency={asset!.currency} /> },
  ];

  return (
    <>
      <Card title="Amortissement">
        <div className="max-w-md"><OptionSelect aria-label="Immobilisation" value={id} onValueChange={(v) => setParams(v ? { tab: "amortissement", id: v } : { tab: "amortissement" }, { replace: true })} options={options} /></div>
      </Card>
      {!asset && <EmptyState icon={TrendingDown} title="Choisissez une immobilisation" description="Le plan d'amortissement complet s'affichera ici." />}
      {asset && (
        <>
          <Card title={`${asset.code} — ${asset.name}`}>
            <div className="grid gap-4 sm:grid-cols-4 text-sm">
              <div><div className="muted">Montant</div><Money value={asset.amountMinor} currency={asset.currency} className="text-base font-medium" /></div>
              <div><div className="muted">Durée</div>{asset.usefulLifeYears ? `${asset.usefulLifeYears} ans` : "— (terrain)"}</div>
              <div><div className="muted">Mode</div>{DEPRECIATION_METHOD_LABELS[asset.depreciationMethod]}</div>
              <div><div className="muted">Annuité</div>{currentRow ? <Money value={currentRow.annuityMinor} currency={asset.currency} className="text-base font-medium" /> : "—"}</div>
            </div>
          </Card>
          <Card title="Plan d'amortissement">
            {schedule.length
              ? <DataTable rows={rows} columns={columns} empty="Aucune ligne" />
              : <EmptyState title="Terrain : aucun amortissement" description="Les terrains ne se déprécient pas." />}
          </Card>
        </>
      )}
    </>
  );
}

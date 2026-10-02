import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { ASSET_TYPE_LABELS, DEPRECIATION_METHOD_LABELS, straightLineSchedule, type AssetType, type Currency } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Card, DataTable, ErrorNote, StatCard } from "@/components/common";
import { exportTable } from "@/lib/export-table";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { useAssets } from "./AssetListTab";

interface Report {
  year: number; totalCount: number;
  totalsByCurrency: { currency: Currency; totalAmountMinor: string }[];
  accumulatedByCurrency: { currency: Currency; accumulatedMinor: string }[];
  vncByCurrency: { currency: Currency; netBookValueMinor: string }[];
  byType: { type: AssetType; currency: Currency; count: number; totalAmountMinor: string }[];
}

const yearOf = (iso: string) => Number(iso.slice(0, 4));

export function AssetReportTab() {
  const api = useApi();
  const s = useSession();
  const year = new Date().getFullYear();
  const rep = useQuery({ queryKey: useScopedKey("immobilisations-report", year), queryFn: () => api.get<Report>("/immobilisations/report", { year: String(year) }) });
  const list = useAssets();

  const currencies = [...new Set([
    ...(rep.data?.totalsByCurrency.map((x) => x.currency) ?? []),
    ...(rep.data?.accumulatedByCurrency.map((x) => x.currency) ?? []),
    ...(rep.data?.vncByCurrency.map((x) => x.currency) ?? []),
  ])];

  const exportFlat = () => {
    const rows = (list.data ?? []).flatMap((a) => {
      const schedule = straightLineSchedule(BigInt(a.amountMinor), a.usefulLifeYears, yearOf(a.acquisitionDate));
      const base = {
        code: a.code, name: a.name, type: ASSET_TYPE_LABELS[a.type], acq: fmtDate(a.acquisitionDate),
        amount: money(a.amountMinor, a.currency), duration: a.usefulLifeYears ?? "", mode: DEPRECIATION_METHOD_LABELS[a.depreciationMethod],
      };
      if (!schedule.length) return [{ ...base, annee: "", exercice: "", annuite: "", cumul: "", vnc: "" }];
      return schedule.map((r) => ({
        ...base, annee: String(r.index), exercice: String(r.fiscalYear), annuite: money(r.annuityMinor, a.currency),
        cumul: money(r.accumulatedMinor, a.currency), vnc: money(r.netBookValueMinor, a.currency),
      }));
    });
    exportTable("csv", {
      title: `Rapport Immobilisations et Amortissement — ${s.parish?.name ?? "Consolidé"}`,
      columns: [
        { header: "Code", key: "code" }, { header: "Nom", key: "name" }, { header: "Type", key: "type" }, { header: "Date acq.", key: "acq" },
        { header: "Montant", key: "amount", align: "right" }, { header: "Durée", key: "duration" }, { header: "Mode", key: "mode" },
        { header: "Année", key: "annee" }, { header: "Exercice", key: "exercice" }, { header: "Annuité", key: "annuite", align: "right" },
        { header: "Cumul", key: "cumul", align: "right" }, { header: "VNC", key: "vnc", align: "right" },
      ],
      rows,
    });
  };

  return (
    <>
      <ErrorNote error={rep.error} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Nombre d'immobilisations" value={rep.data?.totalCount ?? 0} loading={rep.isLoading} />
      </div>
      {currencies.map((cur) => {
        const total = rep.data?.totalsByCurrency.find((x) => x.currency === cur)?.totalAmountMinor ?? "0";
        const acc = rep.data?.accumulatedByCurrency.find((x) => x.currency === cur)?.accumulatedMinor ?? "0";
        const vnc = rep.data?.vncByCurrency.find((x) => x.currency === cur)?.netBookValueMinor ?? "0";
        return (
          <Card key={cur} title={`Synthèse ${cur}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Total immobilisations" value={money(total, cur)} loading={rep.isLoading} />
              <StatCard label={`Cumul amortissements (${year})`} value={money(acc, cur)} loading={rep.isLoading} />
              <StatCard label="VNC totale" value={money(vnc, cur)} loading={rep.isLoading} />
            </div>
          </Card>
        );
      })}
      <Card title="Répartition par type" actions={<Button size="sm" variant="outline" onClick={exportFlat}><FileDown />Exporter Rapport Immo + Amort CSV</Button>}>
        <DataTable
          rows={(rep.data?.byType ?? []).map((t, i) => ({ ...t, id: String(i) }))}
          loading={rep.isLoading}
          empty="Aucune immobilisation"
          columns={[
            { header: "Type", cell: (t) => ASSET_TYPE_LABELS[t.type] ?? t.type },
            { header: "Devise", cell: (t) => t.currency },
            { header: "Nombre", align: "right", cell: (t) => t.count },
            { header: "Montant total", align: "right", cell: (t) => money(t.totalAmountMinor, t.currency) },
          ]}
        />
      </Card>
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, DataTable, ExportButtons, StatCard } from "@/components/common";
import { exportTable } from "@/lib/export-table";
import { useApi } from "../../core/api";
import { money } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import type { SummaryRow } from "./types";

interface Row { id: string; section: string; devise: string; planned: string; realized: string; variance: string; pct: string; [key: string]: string }

function pct(planned: string, realized: string): string {
  const p = BigInt(planned);
  if (p <= 0n) return "—";
  return `${(Number((BigInt(realized) * 10000n) / p) / 100).toFixed(1)}%`;
}
function variance(planned: string, realized: string): string {
  return (BigInt(planned) - BigInt(realized)).toString();
}

export function BudgetSummaryTab({ year }: { year: number }) {
  const api = useApi();
  const rows = useQuery({ queryKey: useScopedKey("budget-summary", year), queryFn: () => api.get<SummaryRow[]>("/budget/summary", { year: String(year) }) });
  const data = rows.data ?? [];

  const tableRows: Row[] = data.flatMap((r) => [
    { id: `${r.currency}-expenses`, section: "Dépenses", devise: r.currency, planned: money(r.expenses.planned, r.currency), realized: money(r.expenses.realized, r.currency), variance: money(variance(r.expenses.planned, r.expenses.realized), r.currency), pct: pct(r.expenses.planned, r.expenses.realized) },
    { id: `${r.currency}-investments`, section: "Investissements", devise: r.currency, planned: money(r.investments.planned, r.currency), realized: money(r.investments.realized, r.currency), variance: money(variance(r.investments.planned, r.investments.realized), r.currency), pct: pct(r.investments.planned, r.investments.realized) },
    { id: `${r.currency}-total`, section: "TOTAL", devise: r.currency, planned: money(r.total.planned, r.currency), realized: money(r.total.realized, r.currency), variance: money(variance(r.total.planned, r.total.realized), r.currency), pct: r.consumptionBp === null ? "—" : `${(r.consumptionBp / 100).toFixed(1)}%` },
  ]);

  const exportSpec = () => ({
    title: `Suivi budgétaire ${year}`,
    columns: [
      { header: "Section", key: "section" }, { header: "Devise", key: "devise" }, { header: "Prévu", key: "planned", align: "right" as const },
      { header: "Réalisé", key: "realized", align: "right" as const }, { header: "Écart", key: "variance", align: "right" as const }, { header: "%", key: "pct", align: "right" as const },
    ],
    rows: tableRows,
  });

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.flatMap((r) => [
          <StatCard key={`${r.currency}-dep`} label={`Total Budget Dépenses (${r.currency})`} value={money(r.expenses.planned, r.currency)} loading={rows.isLoading} />,
          <StatCard key={`${r.currency}-inv`} label={`Total Budget Investissement (${r.currency})`} value={money(r.investments.planned, r.currency)} loading={rows.isLoading} />,
          <StatCard key={`${r.currency}-tot`} label={`TOTAL (${r.currency})`} value={money(r.total.planned, r.currency)} loading={rows.isLoading} />,
          <StatCard key={`${r.currency}-pct`} label={`% Consommation (${r.currency})`} value={r.consumptionBp === null ? "—" : `${(r.consumptionBp / 100).toFixed(1)}%`} loading={rows.isLoading} />,
        ])}
      </div>
      <Card
        title="Suivi & Écarts"
        actions={(
          <span className="flex items-center gap-2">
            <ExportButtons spec={exportSpec} />
            {/* Dedicated export asked for explicitly by the client, in addition to the generic Excel/PDF/Print/CSV suite above. */}
            <Button size="sm" variant="outline" onClick={() => exportTable("csv", exportSpec())}><FileDown />Exporter Rapport Budget CSV</Button>
          </span>
        )}
      >
        <DataTable<Row>
          rows={tableRows} loading={rows.isLoading} empty="Aucune donnée budgétaire pour cette année"
          columns={[
            { header: "Section", cell: (r) => r.section },
            { header: "Libellé/Devise", cell: (r) => r.devise },
            { header: "Prévu", align: "right", cell: (r) => r.planned },
            { header: "Réalisé", align: "right", cell: (r) => r.realized },
            { header: "Écart", align: "right", cell: (r) => r.variance },
            { header: "%", align: "right", cell: (r) => r.pct },
          ]}
        />
      </Card>
    </>
  );
}

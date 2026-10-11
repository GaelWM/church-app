import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
import {
  accountDisplay, ASSET_ACCOUNT_CODES, ASSET_CURRENCIES, ASSET_ETAT_LABELS, flattenReport, reportAcquisitions, reportAmortissements,
  reportGeneral, reportParCategorie, reportParEtat, reportParLocalisation, reportVnc, toReportRow,
  type AcquisitionGranularity, type AmortissementGrouping, type AssetReportRow, type AssetReportSource, type FlatReportRow, type ReportResult,
} from "@church/shared";
import { Card, DataTable, ErrorNote, ExportButtons, Field, type Column } from "@/components/common";
import { DatePicker, OptionSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { fmtDate, money, today } from "../../core/format";
import { useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { EtatBadge } from "./badges";
import { useAssetRefs } from "./queries";

type ReportKey = "general" | "acquisitions" | "amortissements" | "vnc" | "categorie" | "localisation" | "etat";
const REPORTS: { value: ReportKey; label: string; title: string }[] = [
  { value: "general", label: "État général des immobilisations", title: "État général des immobilisations" },
  { value: "acquisitions", label: "État des acquisitions", title: "État des acquisitions" },
  { value: "amortissements", label: "État des amortissements", title: "État des amortissements" },
  { value: "vnc", label: "État de la VNC", title: "État de la valeur nette comptable" },
  { value: "categorie", label: "État par catégorie", title: "État par catégorie" },
  { value: "localisation", label: "État par localisation", title: "État par localisation" },
  { value: "etat", label: "État par état", title: "État par état du bien" },
];
const ACQ_BY: { value: AcquisitionGranularity; label: string }[] = [{ value: "mois", label: "Par mois" }, { value: "trimestre", label: "Par trimestre" }, { value: "annee", label: "Par année" }];
const AMORT_BY: { value: AmortissementGrouping; label: string }[] = [
  { value: "immobilisation", label: "Par immobilisation" }, { value: "compte", label: "Par compte" }, { value: "sous-compte", label: "Par sous-compte" }, { value: "annee", label: "Par année" },
];
const FIRST_COLUMN: Record<ReportKey, string> = {
  general: "Immobilisation", acquisitions: "Période", amortissements: "", vnc: "Sous-compte", categorie: "Catégorie", localisation: "Localisation", etat: "État",
};
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 82 }, (_, i) => String(THIS_YEAR + 1 - i));

interface ReportData {
  asOf: string;
  rows: (Omit<AssetReportSource, "paMinor" | "faaMinor" | "costMinor"> & { paMinor: string; faaMinor: string; costMinor: string })[];
}
const toSource = (r: ReportData["rows"][number]): AssetReportSource => ({ ...r, paMinor: BigInt(r.paMinor), faaMinor: BigInt(r.faaMinor), costMinor: BigInt(r.costMinor) });

type Flat = FlatReportRow & { id: string; etat?: AssetReportRow["etat"]; isTotal?: boolean };
const amount = (v: bigint, currency: string | null) => (currency ? money(v, currency) : "—");

/** The seven reports of §19, computed from the validated assets; printable and exportable to PDF / Excel like every other list. */
export function AssetReportsTab() {
  const api = useApi();
  const s = useSession();
  const refs = useAssetRefs();
  const [report, setReport] = useState<ReportKey>("general");
  const [acqBy, setAcqBy] = useState<AcquisitionGranularity>("mois");
  const [amortBy, setAmortBy] = useState<AmortissementGrouping>("immobilisation");
  const [f, setF] = useState({ asOf: today(), account: "", locationId: "", currency: "", year: "" });
  const q = useQuery({
    queryKey: useScopedKey("asset-report-data", f),
    queryFn: () => api.get<ReportData>("/immobilisations/reports/data", { asOf: f.asOf, account: f.account, locationId: f.locationId, currency: f.currency, year: f.year }),
  });

  const rows = useMemo<AssetReportRow[]>(() => (q.data?.rows ?? []).map((r) => toReportRow(toSource(r), q.data!.asOf)), [q.data]);
  const result: ReportResult = useMemo(() => {
    switch (report) {
      case "general": return reportGeneral(rows);
      case "acquisitions": return reportAcquisitions(rows, acqBy);
      case "amortissements": return reportAmortissements(rows, amortBy);
      case "vnc": return reportVnc(rows);
      case "categorie": return reportParCategorie(rows);
      case "localisation": return reportParLocalisation(rows);
      case "etat": return reportParEtat(rows);
    }
  }, [rows, report, acqBy, amortBy]);
  const flat = useMemo(() => flattenReport(result), [result]);
  const etatOf = (lineKey: string) => (report === "general" ? result.lines.find((l) => l.key === lineKey)?.rows[0]?.etat : undefined);
  const tableRows: Flat[] = [
    ...flat.lines.map((l, i) => ({ ...l, id: `${l.lineKey}:${l.currency ?? ""}:${i}`, etat: etatOf(l.lineKey) })),
    ...flat.totals.map((l, i) => ({ ...l, id: `total:${l.currency ?? ""}:${i}`, isTotal: true, label: flat.totals.length > 1 ? `Total ${l.currency ?? ""}` : "Total", first: true })),
  ];
  const hasUsd = flat.lines.some((l) => l.usdCostMinor !== null);
  const missing = result.usd.missingRate;
  const firstHeader = report === "amortissements" ? (amortBy === "annee" ? "Exercice" : amortBy === "immobilisation" ? "Immobilisation" : amortBy === "compte" ? "Compte" : "Sous-compte") : FIRST_COLUMN[report];
  const meta = REPORTS.find((r) => r.value === report)!;
  const variant = report === "acquisitions" ? ACQ_BY.find((x) => x.value === acqBy)!.label.toLowerCase() : report === "amortissements" ? AMORT_BY.find((x) => x.value === amortBy)!.label.toLowerCase() : "";
  const title = `${meta.title}${variant ? ` — ${variant}` : ""} — ${s.parish?.name ?? "Consolidé"}`;
  const subtitle = [
    `Situation au ${fmtDate(q.data?.asOf ?? f.asOf)}`, `${result.count} immobilisation(s) validée(s)`,
    f.account && `Compte ${accountDisplay(f.account)}`, f.locationId && `Localisation ${refs.data?.locations.find((l) => l.id === f.locationId)?.name ?? ""}`,
    f.currency && `Devise ${f.currency}`, f.year && `Acquises en ${f.year}`,
  ].filter(Boolean).join(" · ");

  const columns: Column<Flat>[] = [
    { header: firstHeader, cell: (r) => (r.isTotal ? <b>{r.label}</b> : r.first ? r.label : "") },
    ...(report === "general" ? [{ header: "État", cell: (r: Flat) => (r.etat ? <EtatBadge etat={r.etat} /> : "") } as Column<Flat>] : []),
    { header: "Devise", cell: (r) => r.currency ?? "—" },
    { header: "Nombre", align: "right", cell: (r) => r.count },
    { header: "Coût d'acquisition", align: "right", cell: (r) => amount(r.costMinor, r.currency) },
    { header: "Amort. de l'exercice", align: "right", cell: (r) => amount(r.exerciseMinor, r.currency) },
    { header: "Amort. cumulé", align: "right", cell: (r) => amount(r.accumulatedMinor, r.currency) },
    { header: "VNC", align: "right", cell: (r) => amount(r.vncMinor, r.currency) },
    ...(hasUsd ? [
      { header: "Coût (éq. USD)", align: "right", cell: (r: Flat) => (r.usdCostMinor !== null ? money(r.usdCostMinor, "USD") : "") } as Column<Flat>,
      { header: "VNC (éq. USD)", align: "right", cell: (r: Flat) => (r.usdVncMinor !== null ? money(r.usdVncMinor, "USD") : "") } as Column<Flat>,
    ] : []),
  ];

  const spec = () => {
    // "par localisation" lists the assets present on each site; the other reports print their lines and totals.
    if (report === "localisation") {
      return {
        title, subtitle,
        columns: [
          { header: "Localisation", key: "loc" }, { header: "Code", key: "code" }, { header: "Description", key: "desc" }, { header: "État", key: "etat" },
          { header: "Devise", key: "cur" }, { header: "Coût d'acquisition", key: "cost", align: "right" as const }, { header: "VNC", key: "vnc", align: "right" as const },
        ],
        rows: result.lines.flatMap((l) => l.rows.map((a) => ({
          loc: l.label, code: a.code, desc: a.description, etat: ASSET_ETAT_LABELS[a.etat], cur: a.currency, cost: money(a.costMinor, a.currency), vnc: money(a.vncMinor, a.currency),
        }))),
      };
    }
    const cell = (r: Flat, k: "costMinor" | "exerciseMinor" | "accumulatedMinor" | "vncMinor") => amount(r[k], r.currency);
    return {
      title, subtitle,
      columns: [
        { header: firstHeader, key: "label" }, ...(report === "general" ? [{ header: "État", key: "etat" }] : []), { header: "Devise", key: "cur" },
        { header: "Nombre", key: "n", align: "right" as const }, { header: "Coût d'acquisition", key: "cost", align: "right" as const },
        { header: "Amort. de l'exercice", key: "ex", align: "right" as const }, { header: "Amort. cumulé", key: "acc", align: "right" as const }, { header: "VNC", key: "vnc", align: "right" as const },
        ...(hasUsd ? [{ header: "Coût (éq. USD)", key: "usdc", align: "right" as const }, { header: "VNC (éq. USD)", key: "usdv", align: "right" as const }] : []),
      ],
      rows: tableRows.map((r) => ({
        label: r.isTotal || r.first ? r.label : "", etat: r.etat ? ASSET_ETAT_LABELS[r.etat] : "", cur: r.currency ?? "", n: r.count, cost: cell(r, "costMinor"),
        ex: cell(r, "exerciseMinor"), acc: cell(r, "accumulatedMinor"), vnc: cell(r, "vncMinor"),
        usdc: r.usdCostMinor !== null ? money(r.usdCostMinor, "USD") : "", usdv: r.usdVncMinor !== null ? money(r.usdVncMinor, "USD") : "",
      })),
    };
  };

  return (
    <>
      <Card title="États et rapports" actions={<ExportButtons spec={spec} />}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="État"><OptionSelect className="w-auto min-w-64" value={report} onValueChange={(v) => setReport(v as ReportKey)} options={REPORTS.map((r) => ({ value: r.value, label: r.label }))} /></Field>
          {report === "acquisitions" && <Field label="Regroupement"><OptionSelect className="w-auto min-w-36" value={acqBy} onValueChange={(v) => setAcqBy(v as AcquisitionGranularity)} options={ACQ_BY} /></Field>}
          {report === "amortissements" && <Field label="Regroupement"><OptionSelect className="w-auto min-w-44" value={amortBy} onValueChange={(v) => setAmortBy(v as AmortissementGrouping)} options={AMORT_BY} /></Field>}
          <Field label="Situation au"><DatePicker className="min-w-40" value={f.asOf} onChange={(v) => v && setF({ ...f, asOf: v })} /></Field>
          <Field label="Compte"><OptionSelect size="sm" className="w-auto min-w-44" value={f.account} onValueChange={(v) => setF({ ...f, account: v })} options={[{ value: "", label: "Tous" }, ...ASSET_ACCOUNT_CODES.map((c) => ({ value: c, label: accountDisplay(c) }))]} /></Field>
          <Field label="Localisation"><OptionSelect size="sm" className="w-auto min-w-40" value={f.locationId} onValueChange={(v) => setF({ ...f, locationId: v })} options={[{ value: "", label: "Toutes" }, ...(refs.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))]} /></Field>
          <Field label="Devise"><OptionSelect size="sm" className="w-auto min-w-24" value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })} options={[{ value: "", label: "Toutes" }, ...ASSET_CURRENCIES.map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label="Année d'acquisition"><OptionSelect size="sm" className="w-auto min-w-28" value={f.year} onValueChange={(v) => setF({ ...f, year: v })} options={[{ value: "", label: "Toutes" }, ...YEARS.map((y) => ({ value: y, label: y }))]} /></Field>
        </div>
        <ErrorNote error={q.error} />
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <DataTable<Flat> rows={tableRows} columns={columns} loading={q.isLoading} emptyIcon={FileBarChart} empty="Aucune immobilisation validée pour ces critères" />
        <p className="text-xs text-muted-foreground">
          Seules les immobilisations validées (statut Actif) sont comptées. Les devises ne sont jamais additionnées entre elles ; l'équivalent USD utilise le taux enregistré sur chaque bien
          {missing > 0 ? ` (${missing} bien(s) sans taux ne sont pas convertis)` : ""}. Amortissements calculés au prorata de la date de mise en service, jusqu'à la fin du mois de la situation.
        </p>
      </Card>

      {report === "localisation" && result.lines.some((l) => l.rows.length > 0) && (
        <Card title="Biens présents sur chaque site">
          <div className="space-y-2">
            {result.lines.filter((l) => l.rows.length > 0).map((l) => (
              <details key={l.key} className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{l.label} <span className="font-normal text-muted-foreground">· {l.count} bien(s)</span></summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {l.rows.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono">{a.code}</span><span>{a.description}</span><EtatBadge etat={a.etat} />
                      <span className="ml-auto tabular-nums text-muted-foreground">{money(a.vncMinor, a.currency)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

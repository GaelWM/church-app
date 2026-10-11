import { amountsAt, buildSchedule, type DepreciationInput, type DepreciationState } from "./depreciation";
import { ASSET_CATEGORIES, categoryOf, accountDisplay, subaccountDisplay } from "./asset-accounts";
import { ASSET_ETATS, ASSET_ETAT_LABELS, type AssetEtat, type DepreciationMethod, type PersistedAssetStatut } from "./enums";
import { toUsdMinor } from "./money";

/**
 * Pure grouping behind the Immobilisations reports. The screen, the PDF and the Excel export all read
 * these results, so their figures cannot diverge. Totals are always per currency (currencies are never
 * summed together); a USD equivalent is added when the assets carry a frozen exchange rate.
 * Callers pass only the assets that belong in the patrimoine (see countsInPatrimoine).
 */

export interface AssetReportSource {
  id: string; code: string; description: string;
  accountCode: string; subaccountCode: string;
  locationName: string; supplierName: string | null;
  currency: string;
  acquisitionDate: string; inServiceDate: string | null;
  etat: AssetEtat; statut: PersistedAssetStatut;
  method: DepreciationMethod; years: number | null; coefficient: string | null;
  paMinor: bigint; faaMinor: bigint; costMinor: bigint;
  /** "1 USD = X <currency>", frozen on the asset; null when none was recorded. */
  fxRatePerUsd: string | null;
}

export interface AssetReportRow extends AssetReportSource {
  rate: number | null;
  exerciseMinor: bigint; accumulatedMinor: bigint; vncMinor: bigint;
  state: DepreciationState;
}

export interface Figures { costMinor: bigint; exerciseMinor: bigint; accumulatedMinor: bigint; vncMinor: bigint }
/** USD equivalent; `missingRate` counts the non-USD assets left out for lack of a recorded rate. */
export interface UsdTotals extends Figures { missingRate: number }
export interface CurrencyTotals extends Figures { currency: string; count: number; usd: UsdTotals | null }

export interface ReportLine {
  key: string; label: string; count: number;
  totals: CurrencyTotals[]; usd: UsdTotals;
  rows: AssetReportRow[];
}
export interface ReportResult { count: number; lines: ReportLine[]; totals: CurrencyTotals[]; usd: UsdTotals }

export const inputOf = (s: AssetReportSource): DepreciationInput => ({
  method: s.method, costMinor: s.costMinor, years: s.years, inServiceDate: s.inServiceDate, coefficient: s.coefficient,
});

/** Adds the depreciation figures as of `asOf` (ISO date) to a raw asset. */
export function toReportRow(src: AssetReportSource, asOf: string): AssetReportRow {
  const a = amountsAt(inputOf(src), asOf);
  return { ...src, rate: a.rate, exerciseMinor: a.exerciseMinor, accumulatedMinor: a.accumulatedMinor, vncMinor: a.vncMinor, state: a.state };
}

// ---- aggregation ----------------------------------------------------------------------------------

const zero = (): Figures => ({ costMinor: 0n, exerciseMinor: 0n, accumulatedMinor: 0n, vncMinor: 0n });
const plus = (a: Figures, b: Figures): Figures => ({
  costMinor: a.costMinor + b.costMinor, exerciseMinor: a.exerciseMinor + b.exerciseMinor,
  accumulatedMinor: a.accumulatedMinor + b.accumulatedMinor, vncMinor: a.vncMinor + b.vncMinor,
});
const zeroUsd = (): UsdTotals => ({ ...zero(), missingRate: 0 });
const figuresOf = (r: AssetReportRow): Figures => ({
  costMinor: r.costMinor, exerciseMinor: r.exerciseMinor, accumulatedMinor: r.accumulatedMinor, vncMinor: r.vncMinor,
});
const toUsd = (f: Figures, currency: string, rate: string): Figures => ({
  costMinor: toUsdMinor(f.costMinor, currency, rate), exerciseMinor: toUsdMinor(f.exerciseMinor, currency, rate),
  accumulatedMinor: toUsdMinor(f.accumulatedMinor, currency, rate), vncMinor: toUsdMinor(f.vncMinor, currency, rate),
});

interface Item { row: AssetReportRow; f: Figures; year?: number }

function aggregate(items: Item[]): { count: number; totals: CurrencyTotals[]; usd: UsdTotals } {
  const byCurrency = new Map<string, CurrencyTotals>();
  let usd = zeroUsd();
  for (const { row, f } of items) {
    let t = byCurrency.get(row.currency);
    if (!t) {
      t = { currency: row.currency, count: 0, ...zero(), usd: row.currency === "USD" ? null : zeroUsd() };
      byCurrency.set(row.currency, t);
    }
    Object.assign(t, plus(t, f), { count: t.count + 1 });
    const converted = row.currency === "USD" ? f : row.fxRatePerUsd ? toUsd(f, row.currency, row.fxRatePerUsd) : null;
    if (converted) {
      usd = { ...plus(usd, converted), missingRate: usd.missingRate };
      if (t.usd) t.usd = { ...plus(t.usd, converted), missingRate: t.usd.missingRate };
    } else {
      usd.missingRate += 1;
      if (t.usd) t.usd.missingRate += 1;
    }
  }
  return { count: items.length, totals: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)), usd };
}

function group(items: Item[], keyOf: (r: AssetReportRow, it: Item) => { key: string; label: string }, order?: (a: ReportLine, b: ReportLine) => number): ReportResult {
  const buckets = new Map<string, { label: string; items: Item[] }>();
  for (const it of items) {
    const { key, label } = keyOf(it.row, it);
    const b = buckets.get(key) ?? { label, items: [] };
    b.items.push(it);
    buckets.set(key, b);
  }
  const lines: ReportLine[] = [...buckets.entries()].map(([key, b]) => ({
    key, label: b.label, ...aggregate(b.items), rows: b.items.map((i) => i.row),
  }));
  lines.sort(order ?? ((a, b) => a.key.localeCompare(b.key)));
  return { ...aggregate(items), lines };
}

const asItems = (rows: AssetReportRow[]): Item[] => rows.map((row) => ({ row, f: figuresOf(row) }));
/** Lines keyed by asset id (codes are only unique per parish) are listed in code order. */
const byLabel = (a: ReportLine, b: ReportLine) => a.label.localeCompare(b.label);
const byCode = (rows: AssetReportRow[]) => [...rows].sort((a, b) => a.code.localeCompare(b.code));

// ---- the reports ----------------------------------------------------------------------------------

/** État général: one line per asset (coût, amortissement cumulé, VNC, état) plus totals. */
export function reportGeneral(rows: AssetReportRow[]): ReportResult {
  return group(asItems(byCode(rows)), (r) => ({ key: r.id, label: `${r.code} — ${r.description}` }), byLabel);
}

export type AcquisitionGranularity = "mois" | "trimestre" | "annee";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** État des acquisitions by month, quarter or year of the date d'acquisition. */
export function reportAcquisitions(rows: AssetReportRow[], granularity: AcquisitionGranularity): ReportResult {
  return group(asItems(rows), (r) => {
    const [y = "", m = "01"] = r.acquisitionDate.split("-");
    const month = Number(m);
    if (granularity === "annee") return { key: y, label: y };
    if (granularity === "trimestre") { const q = Math.ceil(month / 3); return { key: `${y}-T${q}`, label: `T${q} ${y}` }; }
    return { key: `${y}-${m}`, label: `${MONTHS[month - 1] ?? m} ${y}` };
  });
}

export type AmortissementGrouping = "immobilisation" | "compte" | "sous-compte" | "annee";

/**
 * État des amortissements. "immobilisation", "compte" and "sous-compte" use the figures as of the report
 * date; "annee" gives, for every fiscal year of the depreciation schedules, the annuity, the cumulated
 * depreciation and the VNC at the end of that year.
 */
export function reportAmortissements(rows: AssetReportRow[], by: AmortissementGrouping): ReportResult {
  const depreciable = rows.filter((r) => r.method !== "non_amortissable");
  if (by === "immobilisation") return group(asItems(byCode(depreciable)), (r) => ({ key: r.id, label: `${r.code} — ${r.description}` }), byLabel);
  if (by === "compte") return group(asItems(depreciable), (r) => ({ key: r.accountCode, label: accountDisplay(r.accountCode) }));
  if (by === "sous-compte") return group(asItems(depreciable), (r) => ({ key: r.subaccountCode, label: subaccountDisplay(r.subaccountCode) }));
  const items: Item[] = [];
  for (const row of depreciable) {
    for (const s of buildSchedule(inputOf(row))) {
      items.push({ row, year: s.fiscalYear, f: { costMinor: row.costMinor, exerciseMinor: s.annuityMinor, accumulatedMinor: s.accumulatedMinor, vncMinor: s.vncMinor } });
    }
  }
  const byYear = group(items, (_r, it) => ({ key: String(it.year), label: String(it.year) }));
  // One item per (asset, year) feeds the yearly lines; summing them for the grand total would count every asset once per year.
  // The total is the situation of the assets themselves, as of the report date, like the other groupings.
  return { ...byYear, ...aggregate(asItems(depreciable)) };
}

/** État de la VNC: situation of the valeur nette comptable per sous-compte. */
export function reportVnc(rows: AssetReportRow[]): ReportResult {
  return group(asItems(rows), (r) => ({ key: r.subaccountCode, label: subaccountDisplay(r.subaccountCode) }));
}

/** État par catégorie, in the spec's order; categories without assets show as empty lines. */
export function reportParCategorie(rows: AssetReportRow[]): ReportResult {
  const res = group(asItems(rows), (r) => {
    const c = categoryOf(r.subaccountCode) ?? "Autres";
    return { key: c, label: c };
  }, (a, b) => rank(a.key) - rank(b.key));
  const present = new Set(res.lines.map((l) => l.key));
  const empties: ReportLine[] = ASSET_CATEGORIES.filter((c) => !present.has(c))
    .map((c) => ({ key: c, label: c, count: 0, totals: [], usd: zeroUsd(), rows: [] }));
  return { ...res, lines: [...res.lines, ...empties].sort((a, b) => rank(a.key) - rank(b.key)) };
}
const rank = (c: string) => { const i = (ASSET_CATEGORIES as readonly string[]).indexOf(c); return i < 0 ? ASSET_CATEGORIES.length : i; };

/** État par localisation: the assets present on each site (each line carries them in `rows`). */
export function reportParLocalisation(rows: AssetReportRow[]): ReportResult {
  return group(asItems(byCode(rows)), (r) => ({ key: r.locationName, label: r.locationName }));
}

/** État par état: number of assets and their value in Bon / Mauvais / Déclassé / Perdu (all four always listed). */
export function reportParEtat(rows: AssetReportRow[]): ReportResult {
  const res = group(asItems(rows), (r) => ({ key: r.etat, label: ASSET_ETAT_LABELS[r.etat] }), (a, b) => order(a.key) - order(b.key));
  const present = new Set(res.lines.map((l) => l.key));
  const empties: ReportLine[] = ASSET_ETATS.filter((e) => !present.has(e))
    .map((e) => ({ key: e, label: ASSET_ETAT_LABELS[e], count: 0, totals: [], usd: zeroUsd(), rows: [] }));
  return { ...res, lines: [...res.lines, ...empties].sort((a, b) => order(a.key) - order(b.key)) };
}
const order = (e: string) => (ASSET_ETATS as readonly string[]).indexOf(e);

// ---- flat rows: what a table, a PDF and an Excel sheet all print ------------------------------------------------------------

/** One printed row: a report line in one currency (a line holding two currencies prints two rows; they are never added up). */
export interface FlatReportRow {
  lineKey: string; label: string; currency: string | null; count: number;
  costMinor: bigint; exerciseMinor: bigint; accumulatedMinor: bigint; vncMinor: bigint;
  /** USD equivalent of cost and VNC, when the assets carry a rate; `missingRate` counts those that do not. */
  usdCostMinor: bigint | null; usdVncMinor: bigint | null; missingRate: number;
  /** First row of its line: the label is only shown there. */
  first: boolean;
}

const flatRows = (key: string, label: string, count: number, totals: CurrencyTotals[], first = true): FlatReportRow[] =>
  totals.length
    ? totals.map((t, i) => ({
      lineKey: key, label, currency: t.currency, count: t.count, costMinor: t.costMinor, exerciseMinor: t.exerciseMinor,
      accumulatedMinor: t.accumulatedMinor, vncMinor: t.vncMinor, usdCostMinor: t.usd?.costMinor ?? null, usdVncMinor: t.usd?.vncMinor ?? null,
      missingRate: t.usd?.missingRate ?? 0, first: first && i === 0,
    }))
    : [{ lineKey: key, label, currency: null, count, costMinor: 0n, exerciseMinor: 0n, accumulatedMinor: 0n, vncMinor: 0n, usdCostMinor: null, usdVncMinor: null, missingRate: 0, first }];

export function flattenReport(r: ReportResult): { lines: FlatReportRow[]; totals: FlatReportRow[] } {
  return {
    lines: r.lines.flatMap((l) => flatRows(l.key, l.label, l.count, l.totals)),
    totals: flatRows("total", "Total", r.count, r.totals),
  };
}

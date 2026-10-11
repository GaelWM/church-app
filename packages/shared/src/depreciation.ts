import type { DepreciationMethod } from "./enums";

// ---- Engine used by the Immobilisations module (monthly prorata, linéaire / dégressif / non amortissable) ----
//
// Conventions (to confirm with the client, see the plan): depreciation starts in the month of the
// date de mise en service and that month counts as a full month; the exercice is the calendar year;
// there is no residual value (valeur amortissable = coût d'acquisition); every figure is a bigint in
// minor units and the integer-division remainder always lands in the last period, so the final VNC is 0.

export type DepreciationState = "non_amortissable" | "non_demarre" | "en_amortissement" | "entierement_amorti";

export interface DepreciationInput {
  method: DepreciationMethod;
  /** Coût d'acquisition = PA + FAA, minor units. */
  costMinor: bigint;
  /** Durée d'amortissement in years (ignored for non_amortissable). */
  years: number | null;
  /** ISO date (YYYY-MM-DD) of the mise en service; null = not started. */
  inServiceDate: string | null;
  /** Dégressif coefficient ("2", "1.5", 2.5…), at most 2 decimals. Defaults from the duration when absent. */
  coefficient?: string | number | null;
}

export interface DepreciationRow {
  index: number; // 1-based
  fiscalYear: number;
  /** Months of depreciation falling in this fiscal year. */
  months: number;
  annuityMinor: bigint;
  accumulatedMinor: bigint;
  vncMinor: bigint;
}

export interface DepreciationAmounts {
  /** Annual rate in percent (linéaire 100/durée; dégressif coef×100/durée); null when non amortissable. */
  rate: number | null;
  /** Valeur amortissable: the coût when the asset is depreciable, else 0. */
  depreciableMinor: bigint;
  /** Amortissement de l'exercice (fiscal year of asOf) up to the end of the asOf month. */
  exerciseMinor: bigint;
  /** Amortissement cumulé up to the end of the asOf month. */
  accumulatedMinor: bigint;
  vncMinor: bigint;
  state: DepreciationState;
}

export interface CoefficientBand { min: number; max: number | null; coef: number }

/** Standard dégressif coefficients by duration; editable in the parish settings (asset_degressive_coefficients). */
export const DEFAULT_DEGRESSIVE_COEFFICIENTS: readonly CoefficientBand[] = [
  { min: 3, max: 4, coef: 1.5 },
  { min: 5, max: 6, coef: 2 },
  { min: 7, max: null, coef: 2.5 },
];

/** Coefficient for a duration; durations outside every band (e.g. under 3 years) use 1, i.e. no acceleration. */
export function coefficientFor(years: number, table: readonly CoefficientBand[] = DEFAULT_DEGRESSIVE_COEFFICIENTS): number {
  const band = table.find((b) => years >= b.min && (b.max === null || years <= b.max));
  return band ? band.coef : 1;
}

/** Parses a coefficient to hundredths (2 → 200n); throws on anything not positive with ≤ 2 decimals. */
function coefficientHundredths(c: string | number): bigint {
  const s = typeof c === "number" ? c.toFixed(2) : c;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("Coefficient invalide");
  const [w = "0", f = ""] = s.split(".");
  const v = BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
  if (v <= 0n) throw new Error("Coefficient invalide");
  return v;
}

export function effectiveCoefficient(input: Pick<DepreciationInput, "years" | "coefficient">): string {
  if (input.coefficient !== undefined && input.coefficient !== null && input.coefficient !== "") return String(input.coefficient);
  return String(coefficientFor(input.years ?? 0));
}

/** Annual depreciation rate in percent, rounded to 2 decimals (5 years linear = 20). */
export function rateFor(method: DepreciationMethod, years: number | null, coefficient?: string | number | null): number | null {
  if (method === "non_amortissable" || !years || !Number.isInteger(years) || years <= 0) return null;
  const factor = method === "degressif" ? Number(effectiveCoefficient({ years, coefficient })) : 1;
  return Math.round(((factor * 100) / years) * 100) / 100;
}

/** Valeur amortissable. */
export const depreciableValue = (input: Pick<DepreciationInput, "method" | "costMinor">): bigint =>
  input.method === "non_amortissable" ? 0n : input.costMinor;

const monthIndexOfIso = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) throw new Error("Date invalide");
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
};

interface PlanRow { fiscalYear: number; firstIdx: number; months: number; annuity: bigint; cumEnd: bigint }
interface Plan { start: number; totalMonths: number; rows: PlanRow[] }

/** Builds the yearly plan, or null when the asset is not depreciable / not (validly) started. */
function plan(input: DepreciationInput): Plan | null {
  const { method, costMinor: cost, years, inServiceDate } = input;
  if (method === "non_amortissable" || !years || !Number.isInteger(years) || years <= 0 || !inServiceDate || cost <= 0n) return null;
  const start = monthIndexOfIso(inServiceDate);
  const total = years * 12;
  const end = start + total - 1;
  const rows: PlanRow[] = [];
  let prevCum = 0n;
  let monthsDone = 0;
  const coefH = method === "degressif" ? coefficientHundredths(effectiveCoefficient(input)) : 0n;

  for (let year = Math.floor(start / 12); year <= Math.floor(end / 12); year++) {
    const firstIdx = Math.max(start, year * 12);
    const lastIdx = Math.min(end, year * 12 + 11);
    const months = lastIdx - firstIdx + 1;
    const remaining = total - monthsDone; // months left at the start of this year's depreciation
    const vncBegin = cost - prevCum;
    let annuity: bigint;
    if (method === "lineaire") {
      annuity = (cost * BigInt(monthsDone + months)) / BigInt(total) - prevCum;
    } else if (remaining <= months) {
      annuity = vncBegin; // final year absorbs the remainder
    } else {
      const declining = (vncBegin * coefH * BigInt(months)) / (BigInt(years) * 1200n);
      const linear = (vncBegin * BigInt(months)) / BigInt(remaining); // switch to linear when it is larger
      annuity = declining > linear ? declining : linear;
      if (annuity > vncBegin) annuity = vncBegin;
    }
    prevCum += annuity;
    monthsDone += months;
    rows.push({ fiscalYear: year, firstIdx, months, annuity, cumEnd: prevCum });
  }
  return { start, totalMonths: total, rows };
}

/** Yearly schedule (plan d'amortissement); empty for non-amortissable or not-started assets. */
export function buildSchedule(input: DepreciationInput): DepreciationRow[] {
  const p = plan(input);
  if (!p) return [];
  return p.rows.map((r, i) => ({
    index: i + 1, fiscalYear: r.fiscalYear, months: r.months, annuityMinor: r.annuity,
    accumulatedMinor: r.cumEnd, vncMinor: input.costMinor - r.cumEnd,
  }));
}

/** Cumulative depreciation at the end of month `idx` (year*12 + month0). */
function cumulativeAt(input: DepreciationInput, p: Plan | null, idx: number): bigint {
  if (!p || idx < p.start) return 0n;
  if (idx >= p.start + p.totalMonths - 1) return input.costMinor;
  if (input.method === "lineaire") return (input.costMinor * BigInt(idx - p.start + 1)) / BigInt(p.totalMonths);
  const year = Math.floor(idx / 12);
  const i = p.rows.findIndex((r) => r.fiscalYear === year);
  const row = p.rows[i];
  if (!row) return input.costMinor;
  const prev = i > 0 ? p.rows[i - 1]!.cumEnd : 0n;
  const k = Math.min(Math.max(idx - row.firstIdx + 1, 0), row.months);
  return prev + (row.annuity * BigInt(k)) / BigInt(row.months);
}

/**
 * Depreciation figures as of the end of `asOf`'s month (ISO date, default: now).
 * Missing depreciation parameters (no duration or no mise en service date) yield "non démarré" with
 * VNC = coût; a malformed `asOf` date or coefficient throws (the zod schemas reject them upstream).
 */
export function amountsAt(input: DepreciationInput, asOf: string = new Date().toISOString().slice(0, 10)): DepreciationAmounts {
  const rate = rateFor(input.method, input.years, input.coefficient);
  const depreciableMinor = depreciableValue(input);
  if (input.method === "non_amortissable") {
    return { rate, depreciableMinor, exerciseMinor: 0n, accumulatedMinor: 0n, vncMinor: input.costMinor, state: "non_amortissable" };
  }
  const p = plan(input);
  const idx = monthIndexOfIso(asOf);
  const accumulated = cumulativeAt(input, p, idx);
  const exercise = accumulated - cumulativeAt(input, p, Math.floor(idx / 12) * 12 - 1);
  const state: DepreciationState = !p || idx < p.start ? "non_demarre"
    : accumulated >= input.costMinor ? "entierement_amorti" : "en_amortissement";
  return { rate, depreciableMinor, exerciseMinor: exercise, accumulatedMinor: accumulated, vncMinor: input.costMinor - accumulated, state };
}

// ---- Legacy: yearly straight-line schedule of the first Immobilisations version (removed with it) ----

export interface DepreciationYear {
  index: number; // 1..years
  fiscalYear: number;
  annuityMinor: bigint;
  accumulatedMinor: bigint;
  netBookValueMinor: bigint;
}

/**
 * Straight-line (linéaire) depreciation schedule. No prorata temporis: year 1 is a full year, matching
 * the simple "montant / durée" example the client gave. The last year absorbs the integer-division
 * remainder so cumulated depreciation lands exactly on amountMinor and the final VNC is 0.
 */
export function straightLineSchedule(amountMinor: bigint, years: number | null, acquisitionYear: number): DepreciationYear[] {
  if (!years || years <= 0) return [];
  const base = amountMinor / BigInt(years);
  const remainder = amountMinor - base * BigInt(years);
  let accumulated = 0n;
  const rows: DepreciationYear[] = [];
  for (let i = 1; i <= years; i++) {
    const annuity = i === years ? base + remainder : base;
    accumulated += annuity;
    rows.push({
      index: i, fiscalYear: acquisitionYear + i - 1, annuityMinor: annuity,
      accumulatedMinor: accumulated, netBookValueMinor: amountMinor - accumulated,
    });
  }
  return rows;
}

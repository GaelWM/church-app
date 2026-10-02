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

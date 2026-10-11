/**
 * Asset code: "[ACRONYME] [AAAAMM] [NUMÉRO SÉQUENTIEL]", e.g. "MI 202610 00001".
 * The sequence restarts for each (parish, acronym, month) and is allocated by the database
 * (next_asset_code); this module only formats, parses and computes the month part.
 */

/** The code month is the registration month in the church's local time (the Worker runs in UTC). */
export const ASSET_CODE_TIMEZONE = "Africa/Kinshasa";

export const ASSET_ACRONYM_RE = /^[A-Z]{2,4}$/;
export const ASSET_CODE_RE = /^([A-Z]{2,4}) (\d{4})(0[1-9]|1[0-2]) (\d{5,})$/;

/** "202610" for any instant in October 2026, Kinshasa time. */
export function codePeriod(date: Date = new Date(), timeZone: string = ASSET_CODE_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) throw new Error("Période de code invalide");
  return `${year}${month}`;
}

/** Today's date (YYYY-MM-DD) in the church's time zone: the Worker's UTC "today" is still yesterday between 00:00 and 01:00 local time. */
export function localIsoDate(date: Date = new Date(), timeZone: string = ASSET_CODE_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function formatAssetCode(acronym: string, period: string, sequence: number): string {
  if (!ASSET_ACRONYM_RE.test(acronym)) throw new Error("Acronyme invalide");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(period)) throw new Error("Période invalide");
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("Numéro séquentiel invalide");
  return `${acronym} ${period} ${String(sequence).padStart(5, "0")}`;
}

export interface ParsedAssetCode { acronym: string; period: string; year: number; month: number; sequence: number }

export function parseAssetCode(code: string): ParsedAssetCode | null {
  const m = ASSET_CODE_RE.exec(code);
  if (!m) return null;
  const [, acronym = "", year = "", month = "", seq = ""] = m;
  return { acronym, period: `${year}${month}`, year: Number(year), month: Number(month), sequence: Number(seq) };
}

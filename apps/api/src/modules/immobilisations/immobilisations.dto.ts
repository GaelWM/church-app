import { z } from "zod";
import {
  ASSET_ACCOUNT_CODES, ASSET_CURRENCIES, ASSET_ETATS, DEPRECIATION_METHODS, PERSISTED_ASSET_STATUTS,
} from "@church/shared";

/** A real calendar day: 2026-02-30 has the right shape but is not one. */
export const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // 2026-13-45 is an Invalid Date; 2026-02-30 rolls over to March
};
const iso = z.string().refine(isRealDate, "Date invalide");
/** Query strings arrive as "" when a filter is cleared in the UI. */
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());

export const SORT_FIELDS = ["code", "acquisition_date", "in_service_date", "cost_minor", "description", "registered_at", "created_at"] as const;

/**
 * Register search and filters (spec §17). The sort is limited to stored columns: VNC and amortissement
 * cumulé are computed from the depreciation engine, so they cannot be sorted by the database.
 */
export const listQuerySchema = z.object({
  q: opt(z.string().trim().max(100)),
  account: opt(z.enum(ASSET_ACCOUNT_CODES)),
  subaccount: opt(z.string().max(10)),
  year: opt(z.coerce.number().int().min(1900).max(2200)), // acquisition year
  locationId: opt(z.string().uuid()),
  supplierId: opt(z.string().uuid()),
  currency: opt(z.enum(ASSET_CURRENCIES)),
  mode: opt(z.enum(DEPRECIATION_METHODS)),
  etat: opt(z.enum(ASSET_ETATS)),
  statut: opt(z.enum(PERSISTED_ASSET_STATUTS)),
  from: opt(iso), // acquisition date range
  to: opt(iso),
  /** Depreciation figures are computed up to the end of this date's month (default: today). */
  asOf: opt(iso),
  sort: z.enum(SORT_FIELDS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const discardSchema = z.object({ reason: z.string().trim().min(3, "Motif obligatoire (3 caractères minimum)").max(500) });
export const submitSchema = z.object({ comment: z.string().trim().max(500).optional() });

/** What was printed or exported: logged per asset, so a reprint is traceable. */
export const printLogSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Aucune immobilisation").max(500, "500 étiquettes maximum à la fois"),
  kind: z.enum(["code", "etiquette", "export"]),
});

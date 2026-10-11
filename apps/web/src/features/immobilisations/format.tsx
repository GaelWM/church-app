import {
  accountDisplay, ASSET_ETAT_LABELS, DEPRECIATION_METHOD_LABELS, subaccountDisplay, type AssetEtat, type DepreciationMethod,
} from "@church/shared";
import { fmtDate, money } from "../../core/format";
import type { AssetRefs } from "./types";

export const fmtDateTime = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");

/** A value stored in a request (proposed or old), shown the way the user knows it: ids become names, amounts get their currency. */
export function formatRequestValue(field: string, value: unknown, refs: AssetRefs | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const v = String(value);
  switch (field) {
    case "locationId": return refs?.locations.find((l) => l.id === v)?.name ?? "—";
    case "supplierId": return refs?.suppliers.find((x) => x.id === v)?.name ?? "—";
    case "paMinor": case "faaMinor": return money(v, currency);
    case "method": return DEPRECIATION_METHOD_LABELS[v as DepreciationMethod] ?? v;
    case "accountCode": return accountDisplay(v);
    case "subaccountCode": return subaccountDisplay(v);
    case "acquisitionDate": case "inServiceDate": case "fxRateDate": return fmtDate(v);
    case "usefulLifeYears": return `${v} ans`;
    case "newEtat": case "etat": return ASSET_ETAT_LABELS[v as AssetEtat] ?? v;
    default: return v;
  }
}

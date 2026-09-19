import { formatAmount, type Currency } from "@church/shared";

export const money = (minor: string | bigint | number, currency: Currency) => formatAmount(BigInt(minor), currency);
export const usd = (minor: string | bigint | number) => money(minor, "USD");
/** jj/mm/aaaa */
export const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR").format(new Date(iso.slice(0, 10) + "T00:00:00")) : "");
export const today = () => new Date().toISOString().slice(0, 10);

/** Amount and currency code separately, so the code can be set smaller and muted next to the figure. */
export function moneyParts(minor: string | bigint | number, currency: Currency) {
  const amount = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(BigInt(minor)) / 100).replace(/\u202f/g, "\u00a0");
  return { amount, code: currency };
}

/** French labels for stored enum values (never show raw `mobile_money` / `depense` to users). */
const LABELS: Record<string, string> = { caisse: "Caisse", banque: "Banque", mobile_money: "Mobile money", recette: "Recette", depense: "Dépense" };
export const label = (key: string) => LABELS[key] ?? key;

/** "2026-09" → "sept. 2026" */
export const fmtMonth = (ym: string) => new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(new Date(`${ym}-01T00:00:00`));

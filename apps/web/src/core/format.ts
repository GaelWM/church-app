import { formatAmount, type Currency } from "@church/shared";

export const money = (minor: string | bigint | number, currency: Currency) => formatAmount(BigInt(minor), currency);
export const usd = (minor: string | bigint | number) => money(minor, "USD");
/** jj/mm/aaaa */
export const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR").format(new Date(iso.slice(0, 10) + "T00:00:00")) : "");
export const today = () => new Date().toISOString().slice(0, 10);

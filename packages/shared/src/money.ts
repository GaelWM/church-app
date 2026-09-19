import type { Currency } from "./enums";

/** All amounts are integers in minor units (centimes / cents). No floats touch money. */

/** Parse a user-entered decimal string ("1 250,50", "1250.5") to minor units. */
export function parseAmount(input: string): bigint {
  const cleaned = input.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error("Montant invalide");
  const [whole = "0", frac = ""] = cleaned.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

/**
 * Convert to USD minor units using rate "1 USD = rate CDF". The rate is a
 * decimal string with up to 4 decimals (kept as text to stay exact).
 * Rounds half away from zero.
 */
export function toUsdMinor(amountMinor: bigint, currency: Currency, rateCdfPerUsd: string): bigint {
  if (currency === "USD") return amountMinor;
  const rate = rateToScaled(rateCdfPerUsd); // rate * 10^4
  return divRound(amountMinor * 10_000n, rate);
}

export function rateToScaled(rate: string): bigint {
  if (!/^\d+(\.\d{1,4})?$/.test(rate)) throw new Error("Taux invalide");
  const [w = "0", f = ""] = rate.split(".");
  const scaled = BigInt(w) * 10_000n + BigInt(f.padEnd(4, "0"));
  if (scaled <= 0n) throw new Error("Taux invalide");
  return scaled;
}

function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (abs * 2n + d) / (d * 2n);
  return neg ? -q : q;
}

export function formatAmount(minor: bigint | number, currency: Currency, locale = "fr-FR"): string {
  const value = Number(minor) / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: currency === "CDF" ? "code" : "symbol",
  }).format(value);
}

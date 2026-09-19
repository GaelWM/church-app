import { and, desc, eq, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { accounts, exchangeRates, type Tx } from "@church/db";
import { toUsdMinor, type Currency } from "@church/shared";

/** Latest official rate effective on or before `date`. */
export async function rateOn(tx: Tx, date: string): Promise<string> {
  const [r] = await tx.select().from(exchangeRates).where(lte(exchangeRates.effectiveFrom, date))
    .orderBy(desc(exchangeRates.effectiveFrom), desc(exchangeRates.createdAt)).limit(1);
  if (!r) throw new HTTPException(422, { message: "Aucun taux de change défini" });
  return r.rateCdfPerUsd;
}

export async function usdEquivalent(tx: Tx, date: string, currency: Currency, amountMinor: bigint) {
  const rate = await rateOn(tx, date);
  return { rate, usd: toUsdMinor(amountMinor, currency, rate) };
}

export async function getAccount(tx: Tx, id: string, parishId: string) {
  const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.parishId, parishId)));
  if (!a || !a.active) throw new HTTPException(422, { message: "Compte invalide" });
  return a;
}

/** Balance = sum of validated transactions only. Computed, never stored. */
export async function accountBalance(tx: Tx, accountId: string): Promise<bigint> {
  const r = await tx.execute(sql`
    select coalesce(sum(case when direction = 'in' then amount_minor else -amount_minor end), 0)::text as bal
    from transactions where account_id = ${accountId} and status = 'validee'`);
  return BigInt((r as any)[0].bal);
}

export async function nextReference(tx: Tx, parishId: string, year: number): Promise<string> {
  const r = await tx.execute(sql`select next_reference(${parishId}::uuid, ${year}::int) as ref`);
  return (r as any)[0].ref as string;
}

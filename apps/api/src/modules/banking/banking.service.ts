import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { rateToScaled, toUsdMinor } from "@church/shared";
import { audit } from "../../services/audit";
import { getAccount, nextReference, rateOn, usdEquivalent } from "../../services/ledger";
import type { BankOpInput, ClosePeriodInput, ReconcileInput, ReconciliationQuery } from "./banking.dto";
import * as repo from "./banking.repo";

/** Who is acting, and on which parish: everything the service needs from the request. */
export type Actor = { userId: string; parishId: string };

const CAT_NAME: Record<string, string> = {
  versement: "Versement (caisse vers banque)", retrait: "Retrait (banque vers caisse)", virement: "Virement entre comptes",
  change: "Opération de change", frais: "Frais bancaires et commissions", interets: "Intérêts créditeurs",
};

const FEE_CAT_NAME: Record<string, string> = {
  tenue_compte: "Frais de tenue de compte bancaire", retrait_bancaire: "Frais de retrait bancaire",
  retrait_mobile_money: "Frais de retrait Mobile Money",
};

async function bankCategoryId(tx: Tx, type: string, feeType?: string) {
  const name = (feeType && FEE_CAT_NAME[feeType]) || CAT_NAME[type]!;
  const cat = await repo.findBankCategoryByName(tx, name);
  if (!cat) throw new HTTPException(500, { message: "Catégories bancaires non initialisées" });
  return cat.id;
}

export async function createOperation(tx: Tx, actor: Actor, b: BankOpInput) {
  const { parishId, userId } = actor;
  const categoryId = await bankCategoryId(tx, b.type, "feeType" in b ? b.feeType : undefined);
  const year = Number(b.date.slice(0, 4));
  const base = { parishId, categoryId, date: b.date, status: "brouillon", enteredBy: userId, description: b.description ?? null };
  const rows: repo.TransactionInsert[] = [];

  if ("accountId" in b) {
    const acct = await getAccount(tx, b.accountId, parishId);
    if (acct.type === "caisse") throw new HTTPException(422, { message: "Compte bancaire ou mobile money requis" });
    const currency = acct.currency as "CDF" | "USD";
    const { rate, usd } = await usdEquivalent(tx, b.date, currency, b.amountMinor);
    // Fees show as a dépense, interest as a recette.
    rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: b.type === "frais" ? "depense" : "recette",
      direction: b.type === "frais" ? "out" : "in", accountId: acct.id, currency, amountMinor: b.amountMinor, rateUsed: rate, amountUsdMinor: usd });
  } else {
    const from = await getAccount(tx, b.fromAccountId, parishId);
    const to = await getAccount(tx, b.toAccountId, parishId);
    if (from.id === to.id) throw new HTTPException(422, { message: "Comptes identiques" });
    const group = crypto.randomUUID();
    const fromCur = from.currency as "CDF" | "USD";
    const toCur = to.currency as "CDF" | "USD";
    if (b.type === "change") {
      if (fromCur === toCur) throw new HTTPException(422, { message: "Un change requiert deux devises" });
      const actual = b.actualRateCdfPerUsd;
      // Amount received = amount sent converted at the actual rate (exact integer maths).
      const scaled = rateToScaled(actual);
      const received = fromCur === "USD" ? (b.amountMinor * scaled + 5_000n) / 10_000n : (b.amountMinor * 10_000n + scaled / 2n) / scaled;
      const official = await rateOn(tx, b.date);
      // USD equivalents use the OFFICIAL rate so the difference on each leg is the change gain/loss.
      rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: "change", direction: "out", accountId: from.id, currency: fromCur,
        amountMinor: b.amountMinor, rateUsed: actual, amountUsdMinor: toUsdMinor(b.amountMinor, fromCur, official), transferGroupId: group });
      rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: "change", direction: "in", accountId: to.id, currency: toCur,
        amountMinor: received, rateUsed: actual, amountUsdMinor: toUsdMinor(received, toCur, official), transferGroupId: group });
    } else {
      if (fromCur !== toCur) throw new HTTPException(422, { message: "Devises différentes: utilisez un change" });
      if (b.type === "versement" && !(from.type === "caisse" && to.type !== "caisse")) throw new HTTPException(422, { message: "Versement: caisse vers banque" });
      if (b.type === "retrait" && !(to.type === "caisse" && from.type !== "caisse")) throw new HTTPException(422, { message: "Retrait: banque vers caisse" });
      const { rate, usd } = await usdEquivalent(tx, b.date, fromCur, b.amountMinor);
      for (const [dir, acct] of [["out", from], ["in", to]] as const)
        rows.push({ ...base, reference: await nextReference(tx, parishId, year), kind: "transfert", direction: dir, accountId: acct.id,
          currency: fromCur, amountMinor: b.amountMinor, rateUsed: rate, amountUsdMinor: usd, transferGroupId: group });
    }
  }
  const inserted = await repo.insertOperation(tx, rows, userId);
  await audit(tx, { parishId, actorId: userId, action: `bank.${b.type}`, entity: "transaction", entityId: inserted[0]!.id, after: inserted });
  return inserted;
}

/** Rapprochement bancaire: lines of one account for a month, matched or not. */
export async function getReconciliation(tx: Tx, q: ReconciliationQuery) {
  const rows = await repo.listValidatedForMonth(tx, q.accountId, q.year, q.month);
  return { matched: rows.filter((r) => r.reconciledAt), unmatched: rows.filter((r) => !r.reconciledAt) };
}

export async function reconcile(tx: Tx, actor: Actor, { ids, matched }: ReconcileInput) {
  await repo.setReconciled(tx, ids, matched);
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: matched ? "reconcile.match" : "reconcile.unmatch", entity: "transaction", after: { ids } });
}

export const listPeriods = (tx: Tx) => repo.listPeriods(tx);

/** Clôture mensuelle: after closing, nothing can be back-dated into the month. */
export async function closePeriod(tx: Tx, actor: Actor, { year, month }: ClosePeriodInput) {
  const pending = await repo.countPendingInMonth(tx, actor.parishId, year, month);
  if (pending > 0) throw new HTTPException(422, { message: `${pending} écriture(s) en attente dans ce mois` });
  await repo.upsertClosedPeriod(tx, actor.parishId, year, month, actor.userId);
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "period.close", entity: "period", entityId: `${year}-${month}` });
}

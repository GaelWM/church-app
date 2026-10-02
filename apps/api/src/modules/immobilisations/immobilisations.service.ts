import { HTTPException } from "hono/http-exception";
import type { fixedAssets, Tx } from "@church/db";
import { straightLineSchedule, type DepreciationYear } from "@church/shared";
import { audit } from "../../services/audit";
import type { AssetInput } from "./immobilisations.dto";
import * as repo from "./immobilisations.repo";

export type Actor = { userId: string; parishId: string };

const yearOf = (iso: string) => Number(iso.slice(0, 4));

/** The schedule row for `fiscalYear`, or the last row once `fiscalYear` is past the asset's useful life. */
function rowForYear(schedule: DepreciationYear[], fiscalYear: number): DepreciationYear | undefined {
  if (!schedule.length) return undefined;
  const exact = schedule.find((r) => r.fiscalYear === fiscalYear);
  if (exact) return exact;
  const last = schedule[schedule.length - 1]!;
  return fiscalYear > last.fiscalYear ? last : undefined; // undefined: before acquisition
}

type AssetRow = { amountMinor: bigint; usefulLifeYears: number | null; acquisitionDate: string };

function currentYearValues<T extends AssetRow>(row: T, fiscalYear = new Date().getFullYear()) {
  const schedule = straightLineSchedule(row.amountMinor, row.usefulLifeYears, yearOf(row.acquisitionDate));
  const found = rowForYear(schedule, fiscalYear);
  if (!schedule.length) return { ...row, accumulatedMinor: null, netBookValueMinor: null };
  return { ...row, accumulatedMinor: found?.accumulatedMinor ?? 0n, netBookValueMinor: found?.netBookValueMinor ?? row.amountMinor };
}

export async function listAssets(tx: Tx) {
  const rows = await repo.listAssets(tx);
  return rows.map((r) => currentYearValues(r));
}

export async function getAsset(tx: Tx, id: string) {
  const row = await repo.findAsset(tx, id);
  if (!row) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  const schedule = straightLineSchedule(row.amountMinor, row.usefulLifeYears, yearOf(row.acquisitionDate));
  return { ...row, schedule };
}

async function assertLinkedTransaction(tx: Tx, parishId: string, transactionId: string | undefined) {
  if (!transactionId) return;
  const t = await repo.findDepenseTransactionInParish(tx, transactionId, parishId);
  if (!t) throw new HTTPException(422, { message: "L'écriture liée doit être une dépense de cette paroisse" });
}

/** usefulLifeYears is required unless the asset is a terrain, which never has one. */
function normalizeDuration(b: AssetInput) {
  if (b.type === "terrain") return null;
  if (b.usefulLifeYears == null) throw new HTTPException(422, { message: "Durée d'utilité requise (sauf pour un terrain)" });
  return b.usefulLifeYears;
}

export async function createAsset(tx: Tx, actor: Actor, b: AssetInput) {
  await assertLinkedTransaction(tx, actor.parishId, b.transactionId);
  const usefulLifeYears = normalizeDuration(b);
  const code = await repo.nextCode(tx, actor.parishId);
  const values: typeof fixedAssets.$inferInsert = {
    parishId: actor.parishId, code, createdBy: actor.userId,
    type: b.type, name: b.name, acquisitionDate: b.acquisitionDate, currency: b.currency, amountMinor: b.amountMinor,
    invoiceNumber: b.invoiceNumber ?? null, usefulLifeYears, depreciationMethod: b.depreciationMethod,
    condition: b.condition ?? null, location: b.location ?? null, transactionId: b.transactionId ?? null,
  };
  if (b.registeredAt) values.registeredAt = b.registeredAt;
  const a = await repo.insertAsset(tx, values);
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset.create", entity: "fixed_asset", entityId: a.id, after: a });
  return a;
}

export async function updateAsset(tx: Tx, actor: Actor, id: string, b: AssetInput) {
  const before = await repo.findAsset(tx, id);
  if (!before) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  await assertLinkedTransaction(tx, before.parishId, b.transactionId);
  const usefulLifeYears = normalizeDuration(b);
  const values: Record<string, unknown> = {
    type: b.type, name: b.name, acquisitionDate: b.acquisitionDate, currency: b.currency, amountMinor: b.amountMinor,
    invoiceNumber: b.invoiceNumber ?? null, usefulLifeYears, depreciationMethod: b.depreciationMethod,
    condition: b.condition ?? null, location: b.location ?? null, transactionId: b.transactionId ?? null,
    updatedAt: new Date(),
  };
  if (b.registeredAt) values.registeredAt = b.registeredAt;
  const after = await repo.updateAsset(tx, id, values);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: "asset.update", entity: "fixed_asset", entityId: id, before, after });
  return after;
}

export async function deleteAsset(tx: Tx, actor: Actor, id: string) {
  const before = await repo.findAsset(tx, id);
  if (!before) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  await repo.deleteAsset(tx, id);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: "asset.delete", entity: "fixed_asset", entityId: id, before });
  return before;
}

/**
 * Per-currency totals (count is overall, amounts are per currency so different currencies are never
 * summed together), accumulated depreciation and VNC as of `fiscalYear`, and a count+amount breakdown
 * by type — also split by currency for the same reason.
 */
export async function report(tx: Tx, fiscalYear: number) {
  const rows = await repo.listAssets(tx);
  const totalsByCurrency = new Map<string, bigint>();
  const accumulatedByCurrency = new Map<string, bigint>();
  const vncByCurrency = new Map<string, bigint>();
  const byType = new Map<string, { type: string; currency: string; count: number; totalAmountMinor: bigint }>();

  for (const r of rows) {
    totalsByCurrency.set(r.currency, (totalsByCurrency.get(r.currency) ?? 0n) + r.amountMinor);

    const schedule = straightLineSchedule(r.amountMinor, r.usefulLifeYears, yearOf(r.acquisitionDate));
    const found = rowForYear(schedule, fiscalYear);
    const accumulated = found?.accumulatedMinor ?? 0n;
    const vnc = found?.netBookValueMinor ?? r.amountMinor;
    accumulatedByCurrency.set(r.currency, (accumulatedByCurrency.get(r.currency) ?? 0n) + accumulated);
    vncByCurrency.set(r.currency, (vncByCurrency.get(r.currency) ?? 0n) + vnc);

    const key = `${r.type}|${r.currency}`;
    const entry = byType.get(key) ?? { type: r.type, currency: r.currency, count: 0, totalAmountMinor: 0n };
    entry.count += 1;
    entry.totalAmountMinor += r.amountMinor;
    byType.set(key, entry);
  }

  return {
    year: fiscalYear,
    totalCount: rows.length,
    totalsByCurrency: [...totalsByCurrency.entries()].map(([currency, totalAmountMinor]) => ({ currency, totalAmountMinor })),
    accumulatedByCurrency: [...accumulatedByCurrency.entries()].map(([currency, accumulatedMinor]) => ({ currency, accumulatedMinor })),
    vncByCurrency: [...vncByCurrency.entries()].map(([currency, netBookValueMinor]) => ({ currency, netBookValueMinor })),
    byType: [...byType.values()],
  };
}

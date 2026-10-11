import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  assetCodePrefixes, assetConditionHistory, assetLocations, assetRequests, assetSuppliers, auditLog, fixedAssets,
  transactions, users, type Tx,
} from "@church/db";
import { matchAccountCodes } from "@church/shared";
import { isRealDate, type ListQuery } from "./immobilisations.dto";

export type AssetRow = typeof fixedAssets.$inferSelect;
export type AssetInsert = typeof fixedAssets.$inferInsert;
export type AssetListRow = { a: AssetRow; locationName: string; supplierName: string | null };

/** Escapes LIKE wildcards so a search for "100%" or "a_b" is literal. */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** Filters shared by the register, the exports and the reports. `q` also searches supplier and location names. */
export function whereOf(f: Omit<ListQuery, "sort" | "dir" | "page" | "pageSize">): SQL | undefined {
  const c: (SQL | undefined)[] = [];
  const q = f.q?.trim();
  if (q) {
    const like = likeOf(q);
    const m = matchAccountCodes(q);
    c.push(or(
      ilike(fixedAssets.code, like), ilike(fixedAssets.description, like), ilike(fixedAssets.invoiceNumber, like),
      ilike(assetSuppliers.name, like), ilike(assetLocations.name, like), ilike(fixedAssets.currency, like),
      m.accountCodes.length ? inArray(fixedAssets.accountCode, m.accountCodes) : undefined,
      m.subaccountCodes.length ? inArray(fixedAssets.subaccountCode, m.subaccountCodes) : undefined,
      /^\d{4}$/.test(q) ? sql`extract(year from ${fixedAssets.acquisitionDate}) = ${Number(q)}` : undefined,
      isRealDate(q) ? or(eq(fixedAssets.acquisitionDate, q), eq(fixedAssets.inServiceDate, q)) : undefined,
    ));
  }
  if (f.account) c.push(eq(fixedAssets.accountCode, f.account));
  if (f.subaccount) c.push(eq(fixedAssets.subaccountCode, f.subaccount));
  if (f.year) c.push(sql`extract(year from ${fixedAssets.acquisitionDate}) = ${f.year}`);
  if (f.locationId) c.push(eq(fixedAssets.locationId, f.locationId));
  if (f.supplierId) c.push(eq(fixedAssets.supplierId, f.supplierId));
  if (f.currency) c.push(eq(fixedAssets.currency, f.currency));
  if (f.mode) c.push(eq(fixedAssets.depreciationMethod, f.mode));
  if (f.etat) c.push(eq(fixedAssets.etat, f.etat));
  if (f.statut) c.push(eq(fixedAssets.statut, f.statut));
  if (f.from) c.push(sql`${fixedAssets.acquisitionDate} >= ${f.from}`);
  if (f.to) c.push(sql`${fixedAssets.acquisitionDate} <= ${f.to}`);
  return c.length ? and(...c) : undefined;
}

const SORT = {
  code: fixedAssets.code, acquisition_date: fixedAssets.acquisitionDate, in_service_date: fixedAssets.inServiceDate,
  cost_minor: fixedAssets.costMinor, description: fixedAssets.description, registered_at: fixedAssets.registeredAt,
  created_at: fixedAssets.createdAt,
} as const;

const joined = (tx: Tx) =>
  tx.select({ a: fixedAssets, locationName: assetLocations.name, supplierName: assetSuppliers.name }).from(fixedAssets)
    .innerJoin(assetLocations, eq(assetLocations.id, fixedAssets.locationId))
    .leftJoin(assetSuppliers, eq(assetSuppliers.id, fixedAssets.supplierId));

export function listAssets(tx: Tx, f: ListQuery): Promise<AssetListRow[]> {
  const col = SORT[f.sort];
  return joined(tx).where(whereOf(f))
    .orderBy(f.dir === "asc" ? asc(col) : desc(col), asc(fixedAssets.id))
    .limit(f.pageSize).offset((f.page - 1) * f.pageSize);
}

/** Every matching asset (no paging), capped by the caller: exports and reports. */
export const listAllAssets = (tx: Tx, f: ListQuery, limit: number): Promise<AssetListRow[]> =>
  joined(tx).where(whereOf(f)).orderBy(asc(fixedAssets.code)).limit(limit);

export async function countAssets(tx: Tx, f: ListQuery): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(fixedAssets)
    .innerJoin(assetLocations, eq(assetLocations.id, fixedAssets.locationId))
    .leftJoin(assetSuppliers, eq(assetSuppliers.id, fixedAssets.supplierId))
    .where(whereOf(f));
  return r?.n ?? 0;
}

export async function findAssetView(tx: Tx, id: string): Promise<AssetListRow | undefined> {
  return (await joined(tx).where(eq(fixedAssets.id, id)))[0];
}

export async function findAsset(tx: Tx, id: string) {
  return (await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id)))[0];
}

/** Row lock: serialises approvals, état changes and modifications on the same asset. */
export async function lockAsset(tx: Tx, id: string) {
  return (await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id)).for("update"))[0];
}

export async function insertAsset(tx: Tx, values: AssetInsert) {
  const [a] = await tx.insert(fixedAssets).values(values).returning();
  return a!;
}

export async function updateAsset(tx: Tx, id: string, data: Partial<AssetInsert>) {
  const [a] = await tx.update(fixedAssets).set({ ...data, updatedAt: new Date() }).where(eq(fixedAssets.id, id)).returning();
  return a!;
}

export const deleteAsset = (tx: Tx, id: string) => tx.delete(fixedAssets).where(eq(fixedAssets.id, id));

/** Lets the guard trigger through for the rest of this transaction: used only while executing an approved request. */
export const allowGuardedChange = (tx: Tx) => tx.execute(sql`select set_config('app.asset_request_exec', 'on', true)`);

/** Server-generated code, e.g. "MI 202610 00001": atomic per (parish, acronym, month), gap-free on rollback. */
export async function nextCode(tx: Tx, parishId: string, acronym: string, period: string): Promise<string> {
  const r = await tx.execute(sql`select next_asset_code(${parishId}::uuid, ${acronym}, ${period}) as code`);
  return (r as any)[0].code as string;
}

export async function codeTaken(tx: Tx, parishId: string, code: string, exceptId: string): Promise<boolean> {
  const [r] = await tx.select({ id: fixedAssets.id }).from(fixedAssets)
    .where(and(eq(fixedAssets.parishId, parishId), eq(fixedAssets.code, code), ne(fixedAssets.id, exceptId)));
  return !!r;
}

export async function countRequests(tx: Tx, assetId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(assetRequests).where(eq(assetRequests.assetId, assetId));
  return r?.n ?? 0;
}

// ---- referentials the asset refers to ------------------------------------------------------------------

export async function findLocation(tx: Tx, id: string, parishId: string) {
  return (await tx.select().from(assetLocations).where(and(eq(assetLocations.id, id), eq(assetLocations.parishId, parishId))))[0];
}
export async function findSupplier(tx: Tx, id: string, parishId: string) {
  return (await tx.select().from(assetSuppliers).where(and(eq(assetSuppliers.id, id), eq(assetSuppliers.parishId, parishId))))[0];
}
export async function findPrefix(tx: Tx, parishId: string, acronym: string) {
  return (await tx.select().from(assetCodePrefixes).where(and(eq(assetCodePrefixes.parishId, parishId), eq(assetCodePrefixes.acronym, acronym))))[0];
}

/** Belongs to the parish and is a "depense" transaction: the only kind an asset purchase may link to. */
export async function findDepenseTransactionInParish(tx: Tx, id: string, parishId: string) {
  const [t] = await tx.select().from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.parishId, parishId), eq(transactions.kind, "depense")));
  return t;
}

// ---- état history ----------------------------------------------------------------------------------------

export type HistoryInsert = typeof assetConditionHistory.$inferInsert;
export async function insertHistory(tx: Tx, values: HistoryInsert) {
  const [h] = await tx.insert(assetConditionHistory).values(values).returning();
  return h!;
}

export const listHistory = (tx: Tx, assetId: string) =>
  tx.select({ h: assetConditionHistory, locationName: assetLocations.name, actorName: users.fullName })
    .from(assetConditionHistory)
    .innerJoin(assetLocations, eq(assetLocations.id, assetConditionHistory.locationId))
    .innerJoin(users, eq(users.id, assetConditionHistory.actorId))
    .where(eq(assetConditionHistory.assetId, assetId))
    .orderBy(asc(assetConditionHistory.at), asc(assetConditionHistory.id));

// ---- audit trail of one asset (its own actions and those of its requests) --------------------------------

export const auditTrail = (tx: Tx, assetId: string) => {
  const actor = alias(users, "actor");
  return tx.select({ e: auditLog, actorName: actor.fullName }).from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.actorId))
    .where(or(
      and(eq(auditLog.entity, "fixed_asset"), eq(auditLog.entityId, assetId)),
      and(eq(auditLog.entity, "asset_request"), sql`${auditLog.entityId} in (select id::text from asset_requests where asset_id = ${assetId})`),
    ))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
};

export const userName = async (tx: Tx, id: string) =>
  (await tx.select({ n: users.fullName }).from(users).where(eq(users.id, id)))[0]?.n ?? null;

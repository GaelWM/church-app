import { and, desc, eq, sql } from "drizzle-orm";
import { fixedAssets, transactions, type Tx } from "@church/db";

export const listAssets = (tx: Tx) => tx.select().from(fixedAssets).orderBy(desc(fixedAssets.createdAt));

export async function findAsset(tx: Tx, id: string) {
  const [a] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id));
  return a;
}

export async function insertAsset(tx: Tx, values: typeof fixedAssets.$inferInsert) {
  const [a] = await tx.insert(fixedAssets).values(values).returning();
  return a!;
}

export async function updateAsset(tx: Tx, id: string, data: Record<string, unknown>) {
  const [a] = await tx.update(fixedAssets).set(data).where(eq(fixedAssets.id, id)).returning();
  return a;
}

export const deleteAsset = (tx: Tx, id: string) => tx.delete(fixedAssets).where(eq(fixedAssets.id, id));

/** Belongs to the parish and is a "depense" transaction — the only kind an asset purchase may link to. */
export async function findDepenseTransactionInParish(tx: Tx, id: string, parishId: string) {
  const [t] = await tx.select().from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.parishId, parishId), eq(transactions.kind, "depense")));
  return t;
}

/** Server-generated register code: IMMO-001, IMMO-002, ... per parish, never reset by year. */
export async function nextCode(tx: Tx, parishId: string): Promise<string> {
  const r = await tx.execute(sql`select next_asset_code(${parishId}::uuid) as code`);
  return (r as any)[0].code as string;
}

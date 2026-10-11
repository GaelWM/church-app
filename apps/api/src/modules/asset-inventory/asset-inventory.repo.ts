import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assetInventories, assetInventoryLines, assetLocations, users, type Tx } from "@church/db";

export type InventoryRow = typeof assetInventories.$inferSelect;
export type LineRow = typeof assetInventoryLines.$inferSelect;

const count = (cond: string) =>
  sql<number>`(select count(*)::int from asset_inventory_lines l where l.inventory_id = ${assetInventories.id} and ${sql.raw(cond)})`;

/** Inventories with the progress figures the list shows. */
export const listInventories = (tx: Tx) =>
  tx.select({
    i: assetInventories, locationName: assetLocations.name,
    total: count("l.asset_id is not null"), checked: count("l.asset_id is not null and l.present is not null"),
    absents: count("l.present = false"), extras: count("l.asset_id is null"),
  }).from(assetInventories).leftJoin(assetLocations, eq(assetLocations.id, assetInventories.locationId))
    .orderBy(desc(assetInventories.createdAt));

export const findInventory = async (tx: Tx, id: string) =>
  (await tx.select({ i: assetInventories, locationName: assetLocations.name }).from(assetInventories)
    .leftJoin(assetLocations, eq(assetLocations.id, assetInventories.locationId)).where(eq(assetInventories.id, id)))[0];

export const lockInventory = async (tx: Tx, id: string) =>
  (await tx.select().from(assetInventories).where(eq(assetInventories.id, id)).for("update"))[0];

export async function nextReference(tx: Tx, parishId: string, year: number) {
  const r = await tx.execute(sql`select next_inventory_reference(${parishId}::uuid, ${year}::int) as ref`);
  return (r as any)[0].ref as string;
}

export async function insertInventory(tx: Tx, v: typeof assetInventories.$inferInsert) {
  return (await tx.insert(assetInventories).values(v).returning())[0]!;
}

/** The théorique: every validated asset (of the location, if one is given), frozen as it is now. Returns how many lines. */
export async function snapshotAssets(tx: Tx, inventoryId: string, parishId: string, locationId: string | null): Promise<number> {
  const rows = await tx.execute(sql`
    insert into asset_inventory_lines (inventory_id, asset_id, expected_code, expected_description, expected_location_id, expected_etat)
    select ${inventoryId}::uuid, a.id, a.code, a.description, a.location_id, a.etat
    from fixed_assets a
    where a.parish_id = ${parishId}::uuid and a.statut = 'actif' ${locationId ? sql`and a.location_id = ${locationId}::uuid` : sql``}
    returning id`);
  return (rows as unknown as unknown[]).length;
}

const expectedLoc = alias(assetLocations, "expected_loc");
const foundLoc = alias(assetLocations, "found_loc");

export const listLines = (tx: Tx, inventoryId: string) =>
  tx.select({ l: assetInventoryLines, expectedLocationName: expectedLoc.name, foundLocationName: foundLoc.name, checkedByName: users.fullName })
    .from(assetInventoryLines)
    .leftJoin(expectedLoc, eq(expectedLoc.id, assetInventoryLines.expectedLocationId))
    .leftJoin(foundLoc, eq(foundLoc.id, assetInventoryLines.foundLocationId))
    .leftJoin(users, eq(users.id, assetInventoryLines.checkedBy))
    .where(eq(assetInventoryLines.inventoryId, inventoryId))
    .orderBy(assetInventoryLines.expectedCode, assetInventoryLines.extraDescription);

export const findLine = async (tx: Tx, inventoryId: string, lineId: string) =>
  (await tx.select().from(assetInventoryLines).where(and(eq(assetInventoryLines.id, lineId), eq(assetInventoryLines.inventoryId, inventoryId))))[0];

export async function updateLine(tx: Tx, id: string, v: Partial<typeof assetInventoryLines.$inferInsert>) {
  return (await tx.update(assetInventoryLines).set(v).where(eq(assetInventoryLines.id, id)).returning())[0]!;
}
export async function insertLine(tx: Tx, v: typeof assetInventoryLines.$inferInsert) {
  return (await tx.insert(assetInventoryLines).values(v).returning())[0]!;
}
export const deleteLine = (tx: Tx, id: string) => tx.delete(assetInventoryLines).where(eq(assetInventoryLines.id, id));
export async function closeInventory(tx: Tx, id: string, userId: string) {
  return (await tx.update(assetInventories).set({ status: "cloture", closedBy: userId, closedAt: new Date() }).where(eq(assetInventories.id, id)).returning())[0]!;
}

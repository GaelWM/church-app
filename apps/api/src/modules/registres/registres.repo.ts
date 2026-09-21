import { getTableName, and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { baptisms, childDedications, marriages, recordFiles, userParishRoles, users, type Tx } from "@church/db";
import type { RecordListQuery } from "./registres.dto";

export const TYPES = {
  dedications: { table: childDedications, recordType: "dedication", entity: "child_dedication", search: [childDedications.childName, childDedications.motherName, childDedications.fatherName] },
  baptisms: { table: baptisms, recordType: "baptism", entity: "baptism", search: [baptisms.fullName, baptisms.phone, baptisms.email, baptisms.place] },
  marriages: { table: marriages, recordType: "marriage", entity: "marriage", search: [marriages.husbandName, marriages.wifeName, marriages.phone] },
} as const;
export type TypeKey = keyof typeof TYPES;

export const listPastors = (tx: Tx, parishId: string) =>
  tx.select({ id: users.id, fullName: users.fullName }).from(userParishRoles)
    .innerJoin(users, eq(users.id, userParishRoles.userId))
    .where(and(eq(userParishRoles.parishId, parishId), eq(userParishRoles.role, "pasteur"), eq(users.active, true)))
    .orderBy(users.fullName);

export const findFile = async (tx: Tx, id: string) => (await tx.select().from(recordFiles).where(eq(recordFiles.id, id)))[0];

export const deleteFile = (tx: Tx, id: string) => tx.delete(recordFiles).where(eq(recordFiles.id, id));

export const listFiles = (tx: Tx, t: TypeKey, recordId: string) =>
  tx.select().from(recordFiles).where(and(eq(recordFiles.recordType, TYPES[t].recordType), eq(recordFiles.recordId, recordId))).orderBy(desc(recordFiles.createdAt));

export async function findRecordRef(tx: Tx, t: TypeKey, id: string) {
  const table: any = TYPES[t].table;
  const [rec] = await tx.select({ id: table.id, parishId: table.parishId }).from(table).where(eq(table.id, id));
  return rec as { id: string; parishId: string } | undefined;
}

export async function insertFile(tx: Tx, values: typeof recordFiles.$inferInsert) {
  const [f] = await tx.insert(recordFiles).values(values).returning();
  return f!;
}

export function listRecords(tx: Tx, t: TypeKey, { from, to, q, pastor }: RecordListQuery) {
  const table: any = TYPES[t].table;
  const conds = [
    from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? gte(table.date, from) : undefined,
    to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? lte(table.date, to) : undefined,
    pastor ? ilike(table.pastorName, `%${pastor.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
    q ? or(...TYPES[t].search.map((col: any) => ilike(col, `%${q.replace(/[%_\\]/g, "\\$&")}%`))) : undefined,
  ].filter(Boolean);
  return tx.select({ r: table, fileCount: sql<number>`(select count(*)::int from record_files rf where rf.record_type = ${TYPES[t].recordType} and rf.record_id = ${sql.raw(`"${getTableName(table)}"."id"`)})` })
    .from(table).where(and(...conds)).orderBy(desc(table.date), desc(table.createdAt)).limit(1000);
}

export async function insertRecord(tx: Tx, t: TypeKey, values: Record<string, unknown>) {
  const [r] = await tx.insert(TYPES[t].table as any).values(values).returning();
  return r as any;
}

export async function findRecord(tx: Tx, t: TypeKey, id: string) {
  const table: any = TYPES[t].table;
  const [row] = await tx.select().from(table).where(eq(table.id, id));
  return row as any;
}

export async function updateRecord(tx: Tx, t: TypeKey, id: string, data: Record<string, unknown>) {
  const table: any = TYPES[t].table;
  const [after] = await tx.update(table).set(data).where(eq(table.id, id)).returning();
  return after as any;
}

export const deleteRecord = (tx: Tx, t: TypeKey, id: string) => tx.delete(TYPES[t].table as any).where(eq((TYPES[t].table as any).id, id));

export const listFilesOfRecord = (tx: Tx, t: TypeKey, recordId: string) =>
  tx.select().from(recordFiles).where(and(eq(recordFiles.recordType, TYPES[t].recordType), eq(recordFiles.recordId, recordId)));

export const deleteFilesByIds = (tx: Tx, ids: string[]) => tx.delete(recordFiles).where(inArray(recordFiles.id, ids));

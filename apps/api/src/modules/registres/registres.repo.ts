import { getTableName, and, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { baptisms, childDedications, marriages, recordFiles, userParishRoles, users, type Tx } from "@church/db";
import { TX_STATUSES, type TxStatus } from "@church/shared";
import type { RecordListQuery } from "./registres.dto";

/** `workflow`: the register goes through the Pasteur assistant → Pasteur titulaire circuit (status columns). */
export const TYPES = {
  dedications: { table: childDedications, recordType: "dedication", entity: "child_dedication", workflow: false, search: [childDedications.childName, childDedications.motherName, childDedications.fatherName] },
  baptisms: { table: baptisms, recordType: "baptism", entity: "baptism", workflow: true, search: [baptisms.fullName, baptisms.phone, baptisms.email, baptisms.place] },
  marriages: { table: marriages, recordType: "marriage", entity: "marriage", workflow: true, search: [marriages.husbandName, marriages.wifeName, marriages.phone] },
} as const;
export type TypeKey = keyof typeof TYPES;

export const typeOfRecordType = (recordType: string) => (Object.keys(TYPES) as TypeKey[]).find((t) => TYPES[t].recordType === recordType);

export const listPastors = (tx: Tx, parishId: string) =>
  tx.selectDistinct({ id: users.id, fullName: users.fullName }).from(userParishRoles)
    .innerJoin(users, eq(users.id, userParishRoles.userId))
    .where(and(eq(userParishRoles.parishId, parishId), inArray(userParishRoles.role, ["pasteur", "pasteur_assistant"]), eq(users.active, true)))
    .orderBy(users.fullName);

// Asset files live in the same table but belong to the Immobilisations module (own permissions and audit): never served from here.
export const findFile = async (tx: Tx, id: string) => (await tx.select().from(recordFiles).where(and(eq(recordFiles.id, id), ne(recordFiles.recordType, "asset"))))[0];

export const deleteFile = (tx: Tx, id: string) => tx.delete(recordFiles).where(eq(recordFiles.id, id));

export const listFiles = (tx: Tx, t: TypeKey, recordId: string) =>
  tx.select().from(recordFiles).where(and(eq(recordFiles.recordType, TYPES[t].recordType), eq(recordFiles.recordId, recordId))).orderBy(desc(recordFiles.createdAt));

export async function findRecordRef(tx: Tx, t: TypeKey, id: string) {
  const table: any = TYPES[t].table;
  const [rec] = await tx.select({ id: table.id, parishId: table.parishId, createdBy: table.createdBy, ...(TYPES[t].workflow ? { status: table.status } : {}) })
    .from(table).where(eq(table.id, id));
  return rec as { id: string; parishId: string; createdBy: string; status?: TxStatus } | undefined;
}

export async function insertFile(tx: Tx, values: typeof recordFiles.$inferInsert) {
  const [f] = await tx.insert(recordFiles).values(values).returning();
  return f!;
}

export function listRecords(tx: Tx, t: TypeKey, { from, to, q, pastor, status }: RecordListQuery) {
  const table: any = TYPES[t].table;
  const statuses = TYPES[t].workflow && status ? status.split(",").filter((x): x is TxStatus => (TX_STATUSES as readonly string[]).includes(x)) : [];
  const conds = [
    from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? gte(table.date, from) : undefined,
    to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? lte(table.date, to) : undefined,
    pastor ? ilike(table.pastorName, `%${pastor.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
    q ? or(...TYPES[t].search.map((col: any) => ilike(col, `%${q.replace(/[%_\\]/g, "\\$&")}%`))) : undefined,
    // a status filter with no valid value (e.g. "À valider" for someone who validates nothing) matches nothing
    TYPES[t].workflow && status ? (statuses.length ? inArray(table.status, statuses) : sql`false`) : undefined,
  ].filter(Boolean);
  const col = (c: string) => sql.raw(`"${getTableName(table)}"."${c}"`);
  const nameOf = (c: string) => sql<string | null>`(select u.full_name from users u where u.id = ${col(c)})`;
  return tx.select({
    r: table,
    fileCount: sql<number>`(select count(*)::int from record_files rf where rf.record_type = ${TYPES[t].recordType} and rf.record_id = ${col("id")})`,
    createdByName: nameOf("created_by"),
    ...(TYPES[t].workflow ? { validator1Name: nameOf("validator1_id"), validator2Name: nameOf("validator2_id") } : {}),
  }).from(table).where(and(...conds)).orderBy(desc(table.date), desc(table.createdAt)).limit(1000);
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

/** Moves a workflow record out of `from` (compare-and-set): undefined when someone else acted first. */
export async function transitionRecord(tx: Tx, t: TypeKey, id: string, from: TxStatus, patch: Record<string, unknown>) {
  const table: any = TYPES[t].table;
  const [after] = await tx.update(table).set(patch).where(and(eq(table.id, id), eq(table.status, from))).returning();
  return after as any;
}

export const deleteRecord = (tx: Tx, t: TypeKey, id: string) => tx.delete(TYPES[t].table as any).where(eq((TYPES[t].table as any).id, id));

export const listFilesOfRecord = (tx: Tx, t: TypeKey, recordId: string) =>
  tx.select().from(recordFiles).where(and(eq(recordFiles.recordType, TYPES[t].recordType), eq(recordFiles.recordId, recordId)));

export const deleteFilesByIds = (tx: Tx, ids: string[]) => tx.delete(recordFiles).where(inArray(recordFiles.id, ids));

import { and, asc, eq, sql } from "drizzle-orm";
import { assetCodePrefixes, assetLocations, assetSuppliers, type Tx } from "@church/db";

export const listPrefixes = (tx: Tx) => tx.select().from(assetCodePrefixes).orderBy(asc(assetCodePrefixes.acronym));
export const listLocations = (tx: Tx) => tx.select().from(assetLocations).orderBy(asc(assetLocations.sortOrder), asc(assetLocations.name));
export const listSuppliers = (tx: Tx) => tx.select().from(assetSuppliers).orderBy(asc(assetSuppliers.name));

export const findPrefixById = async (tx: Tx, id: string) => (await tx.select().from(assetCodePrefixes).where(eq(assetCodePrefixes.id, id)))[0];
export const findLocationById = async (tx: Tx, id: string) => (await tx.select().from(assetLocations).where(eq(assetLocations.id, id)))[0];
export const findSupplierById = async (tx: Tx, id: string) => (await tx.select().from(assetSuppliers).where(eq(assetSuppliers.id, id)))[0];

export const prefixExists = async (tx: Tx, parishId: string, acronym: string) =>
  !!(await tx.select({ id: assetCodePrefixes.id }).from(assetCodePrefixes).where(and(eq(assetCodePrefixes.parishId, parishId), eq(assetCodePrefixes.acronym, acronym))))[0];
export const locationNameExists = async (tx: Tx, parishId: string, name: string, exceptId?: string) =>
  !!(await tx.select({ id: assetLocations.id }).from(assetLocations)
    .where(and(eq(assetLocations.parishId, parishId), sql`lower(${assetLocations.name}) = lower(${name})`, exceptId ? sql`${assetLocations.id} <> ${exceptId}` : undefined)))[0];
export const supplierNameExists = async (tx: Tx, parishId: string, name: string, exceptId?: string) =>
  !!(await tx.select({ id: assetSuppliers.id }).from(assetSuppliers)
    .where(and(eq(assetSuppliers.parishId, parishId), sql`lower(${assetSuppliers.name}) = lower(${name})`, exceptId ? sql`${assetSuppliers.id} <> ${exceptId}` : undefined)))[0];

export async function insertPrefix(tx: Tx, v: typeof assetCodePrefixes.$inferInsert) { return (await tx.insert(assetCodePrefixes).values(v).returning())[0]!; }
export async function insertLocation(tx: Tx, v: typeof assetLocations.$inferInsert) { return (await tx.insert(assetLocations).values(v).returning())[0]!; }
export async function insertSupplier(tx: Tx, v: typeof assetSuppliers.$inferInsert) { return (await tx.insert(assetSuppliers).values(v).returning())[0]!; }
export async function updatePrefix(tx: Tx, id: string, v: Partial<typeof assetCodePrefixes.$inferInsert>) { return (await tx.update(assetCodePrefixes).set(v).where(eq(assetCodePrefixes.id, id)).returning())[0]!; }
export async function updateLocation(tx: Tx, id: string, v: Partial<typeof assetLocations.$inferInsert>) { return (await tx.update(assetLocations).set(v).where(eq(assetLocations.id, id)).returning())[0]!; }
export async function updateSupplier(tx: Tx, id: string, v: Partial<typeof assetSuppliers.$inferInsert>) { return (await tx.update(assetSuppliers).set(v).where(eq(assetSuppliers.id, id)).returning())[0]!; }

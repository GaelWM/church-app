import { desc, eq } from "drizzle-orm";
import { categories, exchangeRates, funds, users, type Db } from "@church/db";
import type { CategoryCreateInput, CategoryUpdateInput } from "./referential.dto";

export const listCategories = (db: Db) => db.select().from(categories);

export async function insertCategory(db: Db, values: CategoryCreateInput) {
  const [cat] = await db.insert(categories).values(values).returning();
  return cat;
}

export async function updateCategory(db: Db, id: string, values: CategoryUpdateInput) {
  const [cat] = await db.update(categories).set(values).where(eq(categories.id, id)).returning();
  return cat;
}

export const listFunds = (db: Db) => db.select().from(funds);

export const listExchangeRates = (db: Db) =>
  db.select().from(exchangeRates).orderBy(desc(exchangeRates.effectiveFrom), desc(exchangeRates.createdAt));

export async function insertExchangeRate(db: Db, values: typeof exchangeRates.$inferInsert) {
  const [r] = await db.insert(exchangeRates).values(values).returning();
  return r;
}

export const listActiveUserEmails = (db: Db) => db.select({ email: users.email }).from(users).where(eq(users.active, true));

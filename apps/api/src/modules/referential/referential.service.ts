import type { Db } from "@church/db";
import type { z } from "zod";
import type { exchangeRateSchema } from "@church/shared";
import { audit } from "../../services/audit";
import type { CategoryCreateInput, CategoryUpdateInput } from "./referential.dto";
import * as repo from "./referential.repo";

type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;

export const listCategories = (db: Db) => repo.listCategories(db);

export async function createCategory(db: Db, actorId: string, b: CategoryCreateInput) {
  const cat = await repo.insertCategory(db, b);
  await db.transaction((tx) => audit(tx, { actorId, action: "category.create", entity: "category", entityId: cat!.id, after: cat }));
  return cat;
}

export async function updateCategory(db: Db, actorId: string, id: string, b: CategoryUpdateInput) {
  const cat = await repo.updateCategory(db, id, b);
  await db.transaction((tx) => audit(tx, { actorId, action: "category.update", entity: "category", entityId: cat!.id, after: cat }));
  return cat;
}

export const listFunds = (db: Db) => repo.listFunds(db);

export const listExchangeRates = (db: Db) => repo.listExchangeRates(db);

/** Records the new rate; returns it with the emails of the active users to notify. */
export async function setExchangeRate(db: Db, actorId: string, b: ExchangeRateInput) {
  const r = await repo.insertExchangeRate(db, { ...b, setBy: actorId });
  await db.transaction((tx) => audit(tx, { actorId, action: "fx.set", entity: "exchange_rate", entityId: r!.id, after: r }));
  const recipients = await repo.listActiveUserEmails(db);
  return { rate: r, recipients };
}

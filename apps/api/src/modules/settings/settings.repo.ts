import { and, eq } from "drizzle-orm";
import { settings, type Tx } from "@church/db";

export const listByParish = (tx: Tx, parishId: string) => tx.select().from(settings).where(eq(settings.parishId, parishId));

export async function findByKey(tx: Tx, parishId: string, key: string) {
  const [ex] = await tx.select().from(settings).where(and(eq(settings.parishId, parishId), eq(settings.key, key)));
  return ex;
}

export const update = (tx: Tx, id: string, value: unknown, updatedBy: string) =>
  tx.update(settings).set({ value: value as any, updatedBy, updatedAt: new Date() }).where(eq(settings.id, id));

export const insert = (tx: Tx, parishId: string, key: string, value: unknown, updatedBy: string) =>
  tx.insert(settings).values({ parishId, key, value: value as any, updatedBy });

import { desc, eq, inArray, isNull, or } from "drizzle-orm";
import { auditLog, users, type Db } from "@church/db";

export const listEntries = (db: Db, parishIds: string[], includeGlobal: boolean) => {
  // Global entries (users, categories, exchange rate) carry no parish: Administrateurs see them too.
  const scope = includeGlobal
    ? or(inArray(auditLog.parishId, parishIds), isNull(auditLog.parishId))
    : inArray(auditLog.parishId, parishIds);
  return db.select({ log: auditLog, actorName: users.fullName, actorEmail: users.email })
    .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId)).where(scope).orderBy(desc(auditLog.at)).limit(500);
};

export const listUserNames = (db: Db, ids: string[]) =>
  db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids));

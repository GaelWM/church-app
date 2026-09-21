import { inArray } from "drizzle-orm";
import { parishes, type Db } from "@church/db";

export const listParishesByIds = (db: Db, ids: string[]) => db.select().from(parishes).where(inArray(parishes.id, ids));

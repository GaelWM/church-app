import { sql } from "drizzle-orm";

/** `in (${inList(values)})` — Drizzle expands JS arrays as tuples, so build the list explicitly. */
export const inList = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

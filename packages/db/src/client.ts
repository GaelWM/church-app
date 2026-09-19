import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(connectionString: string) {
  // Hyperdrive pools connections; disable prepared statements for pooled use.
  const client = postgres(connectionString, { prepare: false, max: 1 });
  return drizzle(client, { schema });
}

/**
 * Run `fn` in a transaction with RLS context set. SET LOCAL is transaction-scoped,
 * so it is safe with pooled connections.
 */
export async function withScope<T>(
  db: Db,
  scope: { userId: string; parishIds: string[] },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.parish_ids', ${scope.parishIds.join(",")}, true)`);
    await tx.execute(sql`select set_config('app.user_id', ${scope.userId}, true)`);
    return fn(tx);
  });
}

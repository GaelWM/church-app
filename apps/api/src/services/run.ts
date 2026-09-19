import type { Context } from "hono";
import { withScope, type Tx } from "@church/db";
import type { AppEnv } from "../env";

/** Run a handler body in an RLS-scoped DB transaction for the current request. */
export function run<T>(c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withScope(c.get("db"), { userId: c.get("user").id, parishIds: c.get("parishIds") }, fn);
}

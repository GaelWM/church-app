import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import type { z } from "zod";
import type { accountSchema } from "@church/shared";
import { audit } from "../../services/audit";
import type { AccountUpdateInput } from "./accounts.dto";
import * as repo from "./accounts.repo";

/** Who is acting, and on which parish: everything the service needs from the request. */
export type Actor = { userId: string; parishId: string | null | undefined };

export const listAccounts = (tx: Tx) => repo.listAccounts(tx);

export async function createAccount(tx: Tx, actor: Actor, b: z.infer<typeof accountSchema>) {
  if (b.parishId !== actor.parishId) throw new HTTPException(400, { message: "Paroisse incohérente" });
  const a = await repo.insertAccount(tx, b);
  await audit(tx, { parishId: b.parishId, actorId: actor.userId, action: "account.create", entity: "account", entityId: a!.id, after: a });
  return a!;
}

export async function updateAccount(tx: Tx, actor: Actor, id: string, b: AccountUpdateInput) {
  const a = await repo.updateAccount(tx, id, b);
  await audit(tx, { parishId: a?.parishId, actorId: actor.userId, action: "account.update", entity: "account", entityId: id, after: a });
  return a;
}

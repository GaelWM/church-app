import type { Context } from "hono";
import type { z } from "zod";
import type { accountSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { run } from "../../services/run";
import type { AccountUpdateInput } from "./accounts.dto";
import * as service from "./accounts.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: c.get("parishId") });

export const listAccounts = async (c: C) => c.json(await run(c, service.listAccounts));

export const createAccount = async (c: C, body: z.infer<typeof accountSchema>) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createAccount(tx, actor, body)), 201);
};

export const updateAccount = async (c: C, body: AccountUpdateInput) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.updateAccount(tx, actor, id, body)));
};

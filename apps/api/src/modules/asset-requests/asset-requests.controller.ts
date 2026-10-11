import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { assetRequestDecisionSchema, type ChangeRequestAction } from "@church/shared";
import type { AppEnv } from "../../env";
import { run } from "../../services/run";
import type { RequestListQuery } from "./asset-requests.dto";
import * as service from "./asset-requests.service";

type C = Context<AppEnv>;
export const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: c.get("parishId") ?? null, roles: c.get("roles") });
const idOf = (c: C) => c.req.param("id" as never) as string;

export const list = async (c: C, q: RequestListQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.listRequests(tx, actor, q)));
};

export const get = async (c: C) => {
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.getRequest(tx, id)));
};

const decide = async (c: C, action: ChangeRequestAction, comment?: string) => {
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.decide(tx, actor, id, action, comment)));
};

/** Approvals take an optional JSON body {comment?}; an empty body is fine. */
const approve = async (c: C, action: ChangeRequestAction) => {
  const parsed = assetRequestDecisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: "Requête invalide" });
  return decide(c, action, parsed.data.comment || undefined);
};

export const approve1 = (c: C) => approve(c, "approve1");
export const approve2 = (c: C) => approve(c, "approve2");
export const reject = (c: C, body: { comment: string }) => decide(c, "reject", body.comment);

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { changeRequestDecisionSchema, type ChangeRequestAction } from "@church/shared";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { ChangeRequestInput, ChangeRequestRejectInput } from "./change-requests.dto";
import * as service from "./change-requests.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: c.get("parishId") ?? null, roles: c.get("roles") as any[] });
const idOf = (c: C) => c.req.param("id" as never) as string;

export const create = async (c: C, body: ChangeRequestInput) => {
  const parishId = requireParish(c);
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createRequest(tx, actor, parishId, body)), 201);
};

export const list = async (c: C) => {
  const actor = actorOf(c);
  const query = { status: c.req.query("status"), mine: c.req.query("mine") === "1" };
  return c.json(await run(c, (tx) => service.listRequests(tx, actor, query)));
};

export const get = async (c: C) => {
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.getRequest(tx, actor, id)));
};

const decide = async (c: C, action: ChangeRequestAction, comment?: string) => {
  const actor = actorOf(c);
  const id = idOf(c);
  return c.json(await run(c, (tx) => service.decide(tx, actor, id, action, comment)));
};

/** Approvals take an optional JSON body {comment?}; an empty body is fine. */
const approve = async (c: C, action: ChangeRequestAction) => {
  const parsed = changeRequestDecisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: "Requête invalide" });
  return decide(c, action, parsed.data.comment || undefined);
};

export const approve1 = (c: C) => approve(c, "approve1");
export const approve2 = (c: C) => approve(c, "approve2");
export const reject = (c: C, body: ChangeRequestRejectInput) => decide(c, "reject", body.comment);

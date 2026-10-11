import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { CheckLine, CreateInventory, FoundLine } from "./asset-inventory.dto";
import * as service from "./asset-inventory.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });
const param = (c: C, name: string) => c.req.param(name as never) as string;

export const list = async (c: C) => c.json(await run(c, (tx) => service.listInventories(tx)));
export const get = async (c: C) => { const id = param(c, "id"); return c.json(await run(c, (tx) => service.getInventory(tx, id))); };
export const create = async (c: C, b: CreateInventory) => { const a = actorOf(c); return c.json(await run(c, (tx) => service.createInventory(tx, a, b)), 201); };
export const checkLine = async (c: C, b: CheckLine) => {
  const a = actorOf(c); const id = param(c, "id"); const lineId = param(c, "lineId");
  return c.json(await run(c, (tx) => service.checkLine(tx, a, id, lineId, b)));
};
export const addFound = async (c: C, b: FoundLine) => { const a = actorOf(c); const id = param(c, "id"); return c.json(await run(c, (tx) => service.addFound(tx, a, id, b)), 201); };
export const deleteFound = async (c: C) => {
  const a = actorOf(c); const id = param(c, "id"); const lineId = param(c, "lineId");
  await run(c, (tx) => service.deleteFound(tx, a, id, lineId));
  return c.body(null, 204);
};
export const close = async (c: C) => { const a = actorOf(c); const id = param(c, "id"); return c.json(await run(c, (tx) => service.closeInventory(tx, a, id))); };

import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { AssetInput } from "./immobilisations.dto";
import * as service from "./immobilisations.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });

export const list = async (c: C) => c.json(await run(c, service.listAssets));

// Registered before "/:id" in the router so "report" is never read as an asset id.
export const report = async (c: C) => {
  const q = Number(c.req.query("year"));
  const year = Number.isFinite(q) && q > 0 ? q : new Date().getFullYear();
  return c.json(await run(c, (tx) => service.report(tx, year)));
};

export const get = async (c: C) => {
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.getAsset(tx, id)));
};

export const create = async (c: C, body: AssetInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createAsset(tx, actor, body)), 201);
};

export const update = async (c: C, body: AssetInput) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.updateAsset(tx, actor, id, body)));
};

export const remove = async (c: C) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  await run(c, (tx) => service.deleteAsset(tx, actor, id));
  return c.body(null, 204);
};

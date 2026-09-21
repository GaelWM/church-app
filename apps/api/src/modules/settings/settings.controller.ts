import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { SettingsPatch } from "./settings.dto";
import * as service from "./settings.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });

export const get = async (c: C) => {
  const parishId = requireParish(c);
  return c.json(await run(c, (tx) => service.get(tx, parishId)));
};

export const update = async (c: C, body: SettingsPatch) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.update(tx, actor, body as Record<string, unknown>)));
};

import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { run } from "../../services/run";
import * as service from "./dashboard.service";

type C = Context<AppEnv>;

export const getDashboard = async (c: C) => {
  const actor: service.Actor = { parishId: c.get("parishId"), roles: c.get("roles") };
  const query: service.DashboardQuery = {
    provisional: c.req.query("provisional"), from: c.req.query("from"), to: c.req.query("to"), currency: c.req.query("currency"),
  };
  return c.json(await run(c, (tx) => service.getDashboard(tx, actor, query)));
};

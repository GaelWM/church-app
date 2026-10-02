import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm } from "../../middleware/auth";
import * as ctrl from "./dashboard.controller";

export const dashboardRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/", requireAnyPerm("transaction.readAll", "transaction.readOwn"), ctrl.getDashboard);

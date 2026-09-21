import { Hono } from "hono";
import type { AppEnv } from "../../env";
import * as ctrl from "./me.controller";

export const meRoutes = new Hono<AppEnv>()
  .get("/me", ctrl.getMe);

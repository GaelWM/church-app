import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { settingsPatchSchema } from "./settings.dto";
import * as ctrl from "./settings.controller";

export const settingsRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/", ctrl.get)
  .put("/", requirePerm("config.manage"), zValidator("json", settingsPatchSchema), (c) => ctrl.update(c, c.req.valid("json")));

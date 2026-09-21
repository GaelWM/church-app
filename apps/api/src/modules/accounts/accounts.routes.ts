import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { accountSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { accountUpdateSchema } from "./accounts.dto";
import * as ctrl from "./accounts.controller";

export const accountRoutes = new Hono<AppEnv>()
  // Mounted at "/": scope parishScope to these paths only, never the whole router.
  .use("/accounts", parishScope).use("/accounts/*", parishScope)
  .get("/accounts", ctrl.listAccounts)
  .post("/accounts", requirePerm("config.manage"), zValidator("json", accountSchema), (c) => ctrl.createAccount(c, c.req.valid("json")))
  .patch("/accounts/:id", requirePerm("config.manage"), zValidator("json", accountUpdateSchema), (c) => ctrl.updateAccount(c, c.req.valid("json")));

import { Hono } from "hono";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { assetSchema } from "./immobilisations.dto";
import * as ctrl from "./immobilisations.controller";

export const assetRoutes = new Hono<AppEnv>()
  .use(parishScope)
  // Viewing the register (list, report, detail) only needs transaction.readAll; writes need asset.manage.
  .use(requirePerm("transaction.readAll"))
  .get("/", ctrl.list)
  // Before "/:id" so "report" is never swallowed by the :id param route.
  .get("/report", ctrl.report)
  .get("/:id", ctrl.get)
  .post("/", requirePerm("asset.manage"), zValidator("json", assetSchema), (c) => ctrl.create(c, c.req.valid("json")))
  .patch("/:id", requirePerm("asset.manage"), zValidator("json", assetSchema), (c) => ctrl.update(c, c.req.valid("json")))
  .delete("/:id", requirePerm("asset.manage"), ctrl.remove);

import { Hono } from "hono";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { requirePerm } from "../../middleware/auth";
import { checkLineSchema, createInventorySchema, foundLineSchema } from "./asset-inventory.dto";
import * as ctrl from "./asset-inventory.controller";

/**
 * Mounted at /api/immobilisations/inventories, inside assetRoutes (parishScope + transaction.readAll already applied).
 * Reading follows readAll; starting, checking and closing an inventory needs asset.manage.
 */
export const assetInventoryRoutes = new Hono<AppEnv>()
  .get("/", ctrl.list)
  .post("/", requirePerm("asset.manage"), zValidator("json", createInventorySchema), (c) => ctrl.create(c, c.req.valid("json")))
  .get("/:id", ctrl.get)
  .put("/:id/lines/:lineId", requirePerm("asset.manage"), zValidator("json", checkLineSchema), (c) => ctrl.checkLine(c, c.req.valid("json")))
  .post("/:id/lines", requirePerm("asset.manage"), zValidator("json", foundLineSchema), (c) => ctrl.addFound(c, c.req.valid("json")))
  .delete("/:id/lines/:lineId", requirePerm("asset.manage"), ctrl.deleteFound)
  .post("/:id/close", requirePerm("asset.manage"), ctrl.close);

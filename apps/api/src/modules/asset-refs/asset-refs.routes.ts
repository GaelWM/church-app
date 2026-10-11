import { Hono } from "hono";
import {
  assetLocationSchema, assetLocationUpdateSchema, assetSupplierSchema, assetSupplierUpdateSchema, prefixSchema, prefixUpdateSchema,
} from "@church/shared";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { requirePerm } from "../../middleware/auth";
import * as ctrl from "./asset-refs.controller";

/**
 * Mounted at /api/immobilisations/refs, inside assetRoutes (parishScope + transaction.readAll already applied).
 * Acronyms and locations are Configuration (config.manage); a supplier can also be added on the fly by whoever
 * registers assets (asset.manage). Nothing here is ever deleted: entries are deactivated.
 */
export const assetRefRoutes = new Hono<AppEnv>()
  .get("/", ctrl.bootstrap)
  .post("/prefixes", requirePerm("config.manage"), zValidator("json", prefixSchema), (c) => ctrl.createPrefix(c, c.req.valid("json")))
  .patch("/prefixes/:id", requirePerm("config.manage"), zValidator("json", prefixUpdateSchema), (c) => ctrl.updatePrefix(c, c.req.valid("json")))
  .post("/locations", requirePerm("config.manage"), zValidator("json", assetLocationSchema), (c) => ctrl.createLocation(c, c.req.valid("json")))
  .patch("/locations/:id", requirePerm("config.manage"), zValidator("json", assetLocationUpdateSchema), (c) => ctrl.updateLocation(c, c.req.valid("json")))
  .post("/suppliers", requirePerm("asset.manage"), zValidator("json", assetSupplierSchema), (c) => ctrl.createSupplier(c, c.req.valid("json")))
  .patch("/suppliers/:id", requirePerm("asset.manage"), zValidator("json", assetSupplierUpdateSchema), (c) => ctrl.updateSupplier(c, c.req.valid("json")));

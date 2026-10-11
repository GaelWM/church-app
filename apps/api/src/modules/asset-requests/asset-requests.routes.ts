import { Hono } from "hono";
import { assetRequestRejectSchema } from "@church/shared";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { requirePerm } from "../../middleware/auth";
import { requestListQuerySchema } from "./asset-requests.dto";
import * as ctrl from "./asset-requests.controller";

/**
 * Mounted at /api/immobilisations/requests, inside assetRoutes (which already applies parishScope and
 * the transaction.readAll check). Who may approve is decided by the shared state machine.
 */
export const assetRequestRoutes = new Hono<AppEnv>()
  .get("/", zValidator("query", requestListQuerySchema), (c) => ctrl.list(c, c.req.valid("query")))
  .get("/:id", ctrl.get)
  .post("/:id/approve1", requirePerm("transaction.validate1"), ctrl.approve1)
  .post("/:id/approve2", requirePerm("transaction.validate2"), ctrl.approve2)
  .post("/:id/reject", zValidator("json", assetRequestRejectSchema), (c) => ctrl.reject(c, c.req.valid("json")));

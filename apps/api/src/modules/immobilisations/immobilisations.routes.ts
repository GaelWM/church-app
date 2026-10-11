import { Hono } from "hono";
import { assetDraftSchema, assetRequestSchema, etatChangeSchema } from "@church/shared";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { assetInventoryRoutes } from "../asset-inventory/asset-inventory.routes";
import { assetRefRoutes } from "../asset-refs/asset-refs.routes";
import { assetRequestRoutes } from "../asset-requests/asset-requests.routes";
import { listQuerySchema, printLogSchema } from "./immobilisations.dto";
import * as ctrl from "./immobilisations.controller";

export const assetRoutes = new Hono<AppEnv>()
  .use(parishScope)
  // Viewing the register only needs transaction.readAll; registering needs asset.manage; approving is decided
  // by the Trésorier / Pasteur permissions inside the request routes.
  .use(requirePerm("transaction.readAll"))
  // Static paths first, so "refs" and "requests" are never read as an asset id.
  .route("/refs", assetRefRoutes)
  .route("/requests", assetRequestRoutes)
  .route("/inventories", assetInventoryRoutes)
  .get("/reports/data", zValidator("query", listQuerySchema), (c) => ctrl.reportData(c, c.req.valid("query")))
  .get("/files/:fileId", ctrl.getFile)
  .delete("/files/:fileId", requirePerm("asset.manage"), ctrl.deleteFile)
  .post("/print-log", zValidator("json", printLogSchema), (c) => ctrl.logPrint(c, c.req.valid("json")))
  .get("/", zValidator("query", listQuerySchema), (c) => ctrl.list(c, c.req.valid("query")))
  .post("/", requirePerm("asset.manage"), zValidator("json", assetDraftSchema), (c) => ctrl.create(c, c.req.valid("json")))
  .get("/:id", ctrl.get)
  .patch("/:id", requirePerm("asset.manage"), zValidator("json", assetDraftSchema), (c) => ctrl.update(c, c.req.valid("json")))
  .delete("/:id", requirePerm("asset.manage"), ctrl.remove)
  .post("/:id/discard", requirePerm("asset.manage"), ctrl.discard)
  .post("/:id/submit", requirePerm("asset.manage"), ctrl.submit)
  .post("/:id/requests", requirePerm("asset.manage"), zValidator("json", assetRequestSchema), (c) => ctrl.createRequest(c, c.req.valid("json")))
  .post("/:id/etat", requirePerm("asset.manage"), zValidator("json", etatChangeSchema), (c) => ctrl.changeEtat(c, c.req.valid("json")))
  .get("/:id/files", ctrl.listFiles)
  .post("/:id/files", requirePerm("asset.manage"), ctrl.addFile)
  .get("/:id/etat-history", ctrl.etatHistory)
  .get("/:id/audit", ctrl.auditTrail);

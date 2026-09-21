import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import * as ctrl from "./audit.controller";

export const auditRoutes = new Hono<AppEnv>()
  // Mounted at "/": scope parishScope to this exact path only, never the whole router.
  .use("/audit", parishScope)
  .get("/audit", requirePerm("audit.view"), ctrl.listAuditLog);

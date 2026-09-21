import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import * as ctrl from "./attachments.controller";

export const attachmentRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/transaction/:txId", ctrl.listForTransaction)
  .post("/transaction/:txId", requirePerm("transaction.create"), ctrl.addToTransaction)
  .get("/:id/file", ctrl.getFile);

import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm, requirePerm } from "../../middleware/auth";
import * as ctrl from "./attachments.controller";

export const attachmentRoutes = new Hono<AppEnv>()
  .use(parishScope)
  // Receipts are financial data: never served to the no-finance profiles (Évangélisation, Pasteur assistant).
  .use(requireAnyPerm("transaction.readAll", "transaction.readOwn"))
  .get("/transaction/:txId", ctrl.listForTransaction)
  .post("/transaction/:txId", requirePerm("transaction.create"), ctrl.addToTransaction)
  .get("/:id/file", ctrl.getFile);

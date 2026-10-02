import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm, requirePerm } from "../../middleware/auth";
import { bankOpSchema, closePeriodSchema, reconcileSchema, reconciliationQuerySchema } from "./banking.dto";
import * as ctrl from "./banking.controller";

const canRead = requireAnyPerm("transaction.readAll", "transaction.readOwn");

export const bankingRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .post("/operations", requirePerm("transaction.create"), zValidator("json", bankOpSchema), (c) => ctrl.createOperation(c, c.req.valid("json")))
  .get("/reconciliation", canRead, zValidator("query", reconciliationQuerySchema), (c) => ctrl.getReconciliation(c, c.req.valid("query")))
  .post("/reconciliation", requirePerm("reconcile"), zValidator("json", reconcileSchema), (c) => ctrl.reconcile(c, c.req.valid("json")))
  .get("/periods", canRead, ctrl.listPeriods)
  .post("/periods/close", requirePerm("period.close"), zValidator("json", closePeriodSchema), (c) => ctrl.closePeriod(c, c.req.valid("json")));

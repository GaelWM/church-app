import { Hono } from "hono";
import { zValidator } from "../../middleware/validate";
import { rejectSchema, transactionInputSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm, requirePerm } from "../../middleware/auth";
import { balanceQuerySchema, batchBodySchema, filterSchema, transactionPatchSchema } from "./transactions.dto";
import * as ctrl from "./transactions.controller";

const canRead = requireAnyPerm("transaction.readAll", "transaction.readOwn");

export const transactionRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/", canRead, zValidator("query", filterSchema.passthrough()), (c) => ctrl.list(c, c.req.valid("query")))
  .get("/config", canRead, ctrl.getConfig)
  .get("/people", canRead, ctrl.listPeople)
  .get("/balance", canRead, zValidator("query", balanceQuerySchema), (c) => ctrl.getBalance(c, c.req.valid("query")))
  .get("/journal", canRead, zValidator("query", filterSchema.passthrough()), (c) => ctrl.journal(c, c.req.valid("query")))
  .get("/:id", canRead, ctrl.getOne)
  .post("/", requirePerm("transaction.create"), zValidator("json", transactionInputSchema), (c) => ctrl.create(c, c.req.valid("json")))
  .patch("/:id", requirePerm("transaction.create"), zValidator("json", transactionPatchSchema), (c) => ctrl.update(c, c.req.valid("json")))
  .delete("/:id", requirePerm("transaction.create"), ctrl.remove)
  // Registered BEFORE "/:id/<action>" so "batch" is never read as an id.
  .post("/batch/:action", zValidator("json", batchBodySchema), (c) => ctrl.batch(c, c.req.valid("json")))
  // Workflow actions.
  .post("/:id/submit", requirePerm("transaction.create"), (c) => ctrl.act(c, "submit"))
  .post("/:id/validate1", requirePerm("transaction.validate1"), (c) => ctrl.act(c, "validate1"))
  .post("/:id/validate2", requirePerm("transaction.validate2"), (c) => ctrl.act(c, "validate2"))
  .post("/:id/reject", zValidator("json", rejectSchema), (c) => ctrl.act(c, "reject", c.req.valid("json").comment))
  // Contre-passation: reversing entry linked to a validated original.
  .post("/:id/reverse", requirePerm("transaction.create"), zValidator("json", rejectSchema), (c) => ctrl.reverse(c, c.req.valid("json")));

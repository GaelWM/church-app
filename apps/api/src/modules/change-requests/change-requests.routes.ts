import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { changeRequestInputSchema, changeRequestRejectSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import * as ctrl from "./change-requests.controller";

export const changeRequestRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .post("/", requirePerm("change.request"), zValidator("json", changeRequestInputSchema), (c) => ctrl.create(c, c.req.valid("json")))
  .get("/", ctrl.list)
  .get("/:id", ctrl.get)
  .post("/:id/approve1", requirePerm("transaction.validate1"), ctrl.approve1)
  .post("/:id/approve2", requirePerm("transaction.validate2"), ctrl.approve2)
  .post("/:id/reject", zValidator("json", changeRequestRejectSchema), (c) => ctrl.reject(c, c.req.valid("json")));

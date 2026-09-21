import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { departmentCreateSchema } from "./departments.dto";
import * as ctrl from "./departments.controller";

export const departmentRoutes = new Hono<AppEnv>()
  // Mounted at "/": scope parishScope to this exact path only, never the whole router.
  .use("/departments", parishScope)
  .get("/departments", ctrl.listDepartments)
  .post("/departments", requirePerm("config.manage"), zValidator("json", departmentCreateSchema), (c) => ctrl.createDepartment(c, c.req.valid("json")));

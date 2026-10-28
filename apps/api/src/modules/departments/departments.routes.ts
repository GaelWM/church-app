import { Hono } from "hono";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { departmentCreateSchema, departmentUpdateSchema } from "./departments.dto";
import * as ctrl from "./departments.controller";

export const departmentRoutes = new Hono<AppEnv>()
  // Mounted at "/": scope parishScope to these paths only, never the whole router.
  .use("/departments", parishScope).use("/departments/*", parishScope)
  .get("/departments", ctrl.listDepartments)
  .post("/departments", requirePerm("config.manage"), zValidator("json", departmentCreateSchema), (c) => ctrl.createDepartment(c, c.req.valid("json")))
  .patch("/departments/:id", requirePerm("config.manage"), zValidator("json", departmentUpdateSchema), (c) => ctrl.renameDepartment(c, c.req.valid("json")));

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { userCreateSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { userRolesSchema } from "./users.dto";
import * as ctrl from "./users.controller";

export const userRoutes = new Hono<AppEnv>()
  .get("/users", ctrl.listUsers)
  .post("/users", zValidator("json", userCreateSchema), (c) => ctrl.createUser(c, c.req.valid("json")))
  .put("/users/:id/roles", zValidator("json", userRolesSchema), (c) => ctrl.updateRoles(c, c.req.valid("json")))
  .post("/users/:id/:state{deactivate|activate}", ctrl.setActive);

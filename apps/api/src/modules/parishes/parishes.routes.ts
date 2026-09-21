import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { parishSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { parishUpdateSchema } from "./parishes.dto";
import * as ctrl from "./parishes.controller";

export const parishRoutes = new Hono<AppEnv>()
  .post("/parishes", zValidator("json", parishSchema), (c) => ctrl.createParish(c, c.req.valid("json")))
  .patch("/parishes/:id", zValidator("json", parishUpdateSchema), (c) => ctrl.updateParish(c, c.req.valid("json")));

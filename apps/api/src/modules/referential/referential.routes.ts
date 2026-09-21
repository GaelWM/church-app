import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { exchangeRateSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { categoryCreateSchema, categoryUpdateSchema } from "./referential.dto";
import * as ctrl from "./referential.controller";

export const referentialRoutes = new Hono<AppEnv>()
  // Categories & funds (shared by all parishes)
  .get("/categories", ctrl.listCategories)
  .post("/categories", zValidator("json", categoryCreateSchema), (c) => ctrl.createCategory(c, c.req.valid("json")))
  .patch("/categories/:id", zValidator("json", categoryUpdateSchema), (c) => ctrl.updateCategory(c, c.req.valid("json")))
  .get("/funds", ctrl.listFunds)

  // Exchange rate (single global rate, history kept)
  .get("/exchange-rates", ctrl.listExchangeRates)
  .post("/exchange-rates", zValidator("json", exchangeRateSchema), (c) => ctrl.setExchangeRate(c, c.req.valid("json")));

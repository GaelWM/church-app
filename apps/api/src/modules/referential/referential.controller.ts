import type { Context } from "hono";
import type { z } from "zod";
import type { exchangeRateSchema } from "@church/shared";
import { rateChanged } from "@church/emails";
import type { AppEnv } from "../../env";
import { safeSend } from "../../services/mailer";
import { requireAdmin } from "../users/admin.guard";
import type { CategoryCreateInput, CategoryUpdateInput } from "./referential.dto";
import * as service from "./referential.service";

type C = Context<AppEnv>;

export const listCategories = async (c: C) => c.json(await service.listCategories(c.get("db")));

export const createCategory = async (c: C, body: CategoryCreateInput) => {
  requireAdmin(c);
  return c.json(await service.createCategory(c.get("db"), c.get("user").id, body), 201);
};

export const updateCategory = async (c: C, body: CategoryUpdateInput) => {
  requireAdmin(c);
  return c.json(await service.updateCategory(c.get("db"), c.get("user").id, c.req.param("id")!, body));
};

export const listFunds = async (c: C) => c.json(await service.listFunds(c.get("db")));

export const listExchangeRates = async (c: C) => c.json(await service.listExchangeRates(c.get("db")));

export const setExchangeRate = async (c: C, b: z.infer<typeof exchangeRateSchema>) => {
  requireAdmin(c);
  const { rate, recipients } = await service.setExchangeRate(c.get("db"), c.get("user").id, b);
  await safeSend(c.get("mailer"), recipients.map((u) => ({ to: u.email, ...rateChanged({ rate: b.rateCdfPerUsd, effectiveFrom: b.effectiveFrom }) })));
  return c.json(rate, 201);
};

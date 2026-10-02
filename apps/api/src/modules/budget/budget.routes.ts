import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm, requirePerm } from "../../middleware/auth";
import { expenseLinePatchSchema, expenseLineSchema, investmentPatchSchema, investmentSchema, yearQuerySchema } from "./budget.dto";
import * as ctrl from "./budget.controller";

const canRead = requirePerm("transaction.readAll");
const canManage = requirePerm("budget.manage");
// A Caissier filling the dépense form needs the investment picker, without seeing the budget pages themselves.
const canReadOptions = requireAnyPerm("transaction.create", "transaction.readAll");

export const budgetRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Registered before "/investments/:id" routes so "options" is never read as an id.
  .get("/investments/options", canReadOptions, ctrl.listInvestmentOptions)

  .get("/expenses", canRead, zValidator("query", yearQuerySchema), (c) => ctrl.listExpenseLines(c, c.req.valid("query")))
  .post("/expenses", canManage, zValidator("json", expenseLineSchema), (c) => ctrl.createExpenseLine(c, c.req.valid("json")))
  .patch("/expenses/:id", canManage, zValidator("json", expenseLinePatchSchema), (c) => ctrl.updateExpenseLine(c, c.req.valid("json")))
  .delete("/expenses/:id", canManage, ctrl.deleteExpenseLine)

  .get("/investments", canRead, zValidator("query", yearQuerySchema), (c) => ctrl.listInvestments(c, c.req.valid("query")))
  .get("/investments/:id/transactions", canRead, ctrl.listInvestmentTransactions)
  .post("/investments", canManage, zValidator("json", investmentSchema), (c) => ctrl.createInvestment(c, c.req.valid("json")))
  .patch("/investments/:id", canManage, zValidator("json", investmentPatchSchema), (c) => ctrl.updateInvestment(c, c.req.valid("json")))
  .delete("/investments/:id", canManage, ctrl.deleteInvestment)

  .get("/summary", canRead, zValidator("query", yearQuerySchema), (c) => ctrl.summary(c, c.req.valid("query")));

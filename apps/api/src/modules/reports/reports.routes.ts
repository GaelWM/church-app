import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { can } from "@church/shared";
import type { AppEnv } from "../../env";
import { parishScope } from "../../middleware/auth";
import { reportQuerySchema } from "./reports.dto";
import * as ctrl from "./reports.controller";

/** Report reads need report.export OR transaction.readAll (caissier has neither). */
const requireReportAccess = async (c: any, next: any) => {
  const roles = c.get("roles");
  if (!can(roles, "report.export") && !can(roles, "transaction.readAll")) throw new HTTPException(403, { message: "Permission refusée" });
  await next();
};

const q = zValidator("query", reportQuerySchema);

export const reportRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .use(requireReportAccess)

  // Users of the current scope, for the initiateur / validateur filters.
  .get("/users", ctrl.listUsers)
  .get("/journal", q, (c) => ctrl.journal(c, c.req.valid("query")))
  .get("/recettes-par-categorie", q, (c) => ctrl.recettesParCategorie(c, c.req.valid("query")))
  .get("/depenses-par-categorie", q, (c) => ctrl.depensesParCategorie(c, c.req.valid("query")))
  .get("/soldes-par-compte", q, (c) => ctrl.soldesParCompte(c, c.req.valid("query")))
  .get("/consolide", q, (c) => ctrl.consolide(c, c.req.valid("query")))
  .get("/transferts", q, (c) => ctrl.transferts(c, c.req.valid("query")))
  .get("/engagements", q, (c) => ctrl.engagements(c, c.req.valid("query")))
  .get("/effectifs", q, (c) => ctrl.effectifs(c, c.req.valid("query")))
  .get("/membres", q, (c) => ctrl.membres(c, c.req.valid("query")))
  .get("/ouvriers", q, (c) => ctrl.ouvriers(c, c.req.valid("query")))
  .get("/dedicaces", q, (c) => ctrl.dedicaces(c, c.req.valid("query")))
  .get("/baptemes", q, (c) => ctrl.baptemes(c, c.req.valid("query")))
  .get("/mariages", q, (c) => ctrl.mariages(c, c.req.valid("query")));

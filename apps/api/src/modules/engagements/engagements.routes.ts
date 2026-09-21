import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { commitmentPaidSchema, commitmentSchema, pledgeSchema, releaseSchema } from "./engagements.dto";
import * as ctrl from "./engagements.controller";

export const engagementRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Read-only member list for pledge/recette pickers (CRUD lives in /api/effectifs/members)
  .get("/members", ctrl.listMembers)

  // Promesses de dons
  .get("/pledges", ctrl.listPledges)
  .post("/pledges", requirePerm("transaction.create"), zValidator("json", pledgeSchema), (c) => ctrl.createPledge(c, c.req.valid("json")))

  // Engagements de dépenses
  .get("/commitments", ctrl.listCommitments)
  .post("/commitments", requirePerm("transaction.create"), zValidator("json", commitmentSchema), (c) => ctrl.createCommitment(c, c.req.valid("json")))
  // Link a commitment to the dépense that paid it.
  .post("/commitments/:id/paid", requirePerm("transaction.create"), zValidator("json", commitmentPaidSchema), (c) => ctrl.markCommitmentPaid(c, c.req.valid("json")))

  // Synthèse par type et devise: engagé / libéré / non libéré.
  .get("/summary", ctrl.summary)

  // Libérations (historique par engagement)
  .get("/:kind{pledges|commitments}/:id/releases", ctrl.listReleases)
  .post("/:kind{pledges|commitments}/:id/releases", requirePerm("transaction.create"), zValidator("json", releaseSchema), (c) => ctrl.createRelease(c, c.req.valid("json")))
  .post("/releases/:id/file", requirePerm("transaction.create"), ctrl.attachReleaseFile)
  .get("/releases/:id/file", ctrl.getReleaseFile);

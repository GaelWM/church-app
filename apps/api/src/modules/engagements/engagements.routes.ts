import { Hono } from "hono";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm, requirePerm } from "../../middleware/auth";
import { commitmentPaidSchema, commitmentSchema, pledgeSchema, releaseSchema } from "./engagements.dto";
import * as ctrl from "./engagements.controller";

const canRead = requireAnyPerm("transaction.readAll", "transaction.readOwn");

export const engagementRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Read-only member list for pledge/recette pickers (CRUD lives in /api/effectifs/members)
  .get("/members", ctrl.listMembers)

  // Promesses de dons
  .get("/pledges", canRead, ctrl.listPledges)
  .post("/pledges", requirePerm("transaction.create"), zValidator("json", pledgeSchema), (c) => ctrl.createPledge(c, c.req.valid("json")))

  // Engagements de dépenses
  .get("/commitments", canRead, ctrl.listCommitments)
  .post("/commitments", requirePerm("transaction.create"), zValidator("json", commitmentSchema), (c) => ctrl.createCommitment(c, c.req.valid("json")))
  // Link a commitment to the dépense that paid it.
  .post("/commitments/:id/paid", requirePerm("transaction.create"), zValidator("json", commitmentPaidSchema), (c) => ctrl.markCommitmentPaid(c, c.req.valid("json")))

  // Synthèse par type et devise: engagé / libéré / non libéré.
  .get("/summary", canRead, ctrl.summary)

  // Libérations (historique par engagement)
  .get("/:kind{pledges|commitments}/:id/releases", canRead, ctrl.listReleases)
  .post("/:kind{pledges|commitments}/:id/releases", requirePerm("transaction.create"), zValidator("json", releaseSchema), (c) => ctrl.createRelease(c, c.req.valid("json")))
  .post("/releases/:id/file", requirePerm("transaction.create"), ctrl.attachReleaseFile)
  .get("/releases/:id/file", canRead, ctrl.getReleaseFile);

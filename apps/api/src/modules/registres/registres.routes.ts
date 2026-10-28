import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parishScope, requireAnyPerm, requirePerm } from "../../middleware/auth";
import { zValidator } from "../../middleware/validate";
import { recordActionSchema } from "./registres.dto";
import * as ctrl from "./registres.controller";

export const registreRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .use(ctrl.readGuard)
  .get("/pastors", ctrl.listPastors)
  // ---- files (defined before /:type routes so "files" is never read as a register)
  .get("/files/:fileId", ctrl.getFile)
  .delete("/files/:fileId", requirePerm("registry.write"), ctrl.deleteFile)
  .get("/:type/:id/files", ctrl.listFiles)
  .post("/:type/:id/files", requirePerm("registry.write"), ctrl.addFile)
  // ---- records
  .get("/:type", ctrl.listRecords)
  .post("/:type", requirePerm("registry.write"), ctrl.createRecord)
  .patch("/:type/:id", requirePerm("registry.write"), ctrl.updateRecord)
  .delete("/:type/:id", requirePerm("registry.write"), ctrl.deleteRecord)
  // ---- circuit Pasteur assistant → Pasteur titulaire (baptêmes, mariages; 404 on dédicaces)
  .post("/:type/:id/submit", requirePerm("registry.write"), zValidator("json", recordActionSchema), (c) => ctrl.actOnRecord("submit")(c, c.req.valid("json")))
  .post("/:type/:id/validate1", requirePerm("registry.validate1"), zValidator("json", recordActionSchema), (c) => ctrl.actOnRecord("validate1")(c, c.req.valid("json")))
  .post("/:type/:id/validate2", requirePerm("registry.validate2"), zValidator("json", recordActionSchema), (c) => ctrl.actOnRecord("validate2")(c, c.req.valid("json")))
  .post("/:type/:id/reject", requireAnyPerm("registry.validate1", "registry.validate2"), zValidator("json", recordActionSchema), (c) => ctrl.actOnRecord("reject")(c, c.req.valid("json")))
  .post("/:type/:id/reopen", requirePerm("registry.validate2"), zValidator("json", recordActionSchema), (c) => ctrl.actOnRecord("reopen")(c, c.req.valid("json")));

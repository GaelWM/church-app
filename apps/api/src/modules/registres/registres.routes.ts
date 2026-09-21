import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
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
  .delete("/:type/:id", requirePerm("registry.write"), ctrl.deleteRecord);

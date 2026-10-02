import { Hono } from "hono";
import { zValidator } from "../../middleware/validate";
import type { AppEnv } from "../../env";
import { parishScope, requirePerm } from "../../middleware/auth";
import { attendanceActionSchema, attendanceDaySchema, attendanceQuerySchema, attendanceSchema, memberSchema, newcomerSchema, workerSchema } from "./effectifs.dto";
import * as ctrl from "./effectifs.controller";

export const effectifRoutes = new Hono<AppEnv>()
  .use(parishScope)

  // Effectifs des cultes: one row per (paroisse, date, culte), same validation flow as transactions.
  .get("/attendance", zValidator("query", attendanceQuerySchema), (c) => ctrl.listAttendance(c, c.req.valid("query")))
  .post("/attendance", requirePerm("transaction.create"), zValidator("json", attendanceSchema), (c) => ctrl.saveAttendance(c, c.req.valid("json")))
  .post("/attendance/day", requirePerm("transaction.create"), zValidator("json", attendanceDaySchema), (c) => ctrl.saveAttendanceDay(c, c.req.valid("json")))
  .post("/attendance/:id/:action{submit|validate1|validate2|reject}", zValidator("json", attendanceActionSchema), (c) => ctrl.transitionAttendance(c, c.req.valid("json")))

  // Membres
  .get("/members", ctrl.listMembers)
  .post("/members", requirePerm("registry.write"), zValidator("json", memberSchema), (c) => ctrl.createMember(c, c.req.valid("json")))
  .put("/members/:id", requirePerm("registry.write"), zValidator("json", memberSchema), (c) => ctrl.updateMember(c, c.req.valid("json")))
  .delete("/members/:id", requirePerm("registry.write"), ctrl.deleteMember)

  // Nouveaux venus
  .get("/newcomers", ctrl.listNewcomers)
  .post("/newcomers", requirePerm("registry.write"), zValidator("json", newcomerSchema), (c) => ctrl.createNewcomer(c, c.req.valid("json")))
  .put("/newcomers/:id", requirePerm("registry.write"), zValidator("json", newcomerSchema), (c) => ctrl.updateNewcomer(c, c.req.valid("json")))
  .delete("/newcomers/:id", requirePerm("registry.write"), ctrl.deleteNewcomer)

  // Ouvriers
  .get("/workers", ctrl.listWorkers)
  .post("/workers", requirePerm("registry.write"), zValidator("json", workerSchema), (c) => ctrl.createWorker(c, c.req.valid("json")))
  .put("/workers/:id", requirePerm("registry.write"), zValidator("json", workerSchema), (c) => ctrl.updateWorker(c, c.req.valid("json")))
  .delete("/workers/:id", requirePerm("registry.write"), ctrl.deleteWorker);

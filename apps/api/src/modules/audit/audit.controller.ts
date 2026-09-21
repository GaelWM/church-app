import type { Context } from "hono";
import type { AppEnv } from "../../env";
import * as service from "./audit.service";

type C = Context<AppEnv>;

export const listAuditLog = async (c: C) =>
  c.json(await service.listAuditLog(c.get("db"), { roles: c.get("roles"), parishIds: c.get("parishIds") }));

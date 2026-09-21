import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { run } from "../../services/run";
import type { DepartmentCreateInput } from "./departments.dto";
import * as service from "./departments.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: c.get("parishId")! });

export const listDepartments = async (c: C) => c.json(await run(c, service.listDepartments));

export const createDepartment = async (c: C, body: DepartmentCreateInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createDepartment(tx, actor, body)), 201);
};

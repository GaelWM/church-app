import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { DepartmentCreateInput, DepartmentUpdateInput } from "./departments.dto";
import * as service from "./departments.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });

export const listDepartments = async (c: C) => c.json(await run(c, service.listDepartments));

export const createDepartment = async (c: C, body: DepartmentCreateInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createDepartment(tx, actor, body)), 201);
};

export const renameDepartment = async (c: C, body: DepartmentUpdateInput) => {
  const actor = actorOf(c);
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.renameDepartment(tx, actor, id, body)));
};

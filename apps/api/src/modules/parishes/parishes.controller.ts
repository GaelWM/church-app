import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { parishSchema } from "@church/shared";
import type { AppEnv } from "../../env";
import { adminParishes, requireAdmin } from "../users/admin.guard";
import type { ParishUpdateInput } from "./parishes.dto";
import * as service from "./parishes.service";

type C = Context<AppEnv>;

export const createParish = async (c: C, body: z.infer<typeof parishSchema>) => {
  requireAdmin(c);
  return c.json(await service.createParish(c.get("db"), c.get("user").id, body), 201);
};

export const updateParish = async (c: C, body: ParishUpdateInput) => {
  const id = c.req.param("id")!;
  if (!adminParishes(c).includes(id)) throw new HTTPException(403, { message: "Permission refusée" });
  return c.json(await service.updateParish(c.get("db"), c.get("user").id, id, body));
};

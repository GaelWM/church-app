import type { Context } from "hono";
import type { AppEnv } from "../../env";
import * as service from "./me.service";

type C = Context<AppEnv>;

export const getMe = async (c: C) => c.json(await service.getProfile(c.get("db"), c.get("user"), c.get("memberships")));

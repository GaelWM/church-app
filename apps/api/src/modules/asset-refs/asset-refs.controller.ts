import type { Context } from "hono";
import type {
  assetLocationSchema, assetLocationUpdateSchema, assetSupplierSchema, assetSupplierUpdateSchema, prefixSchema, prefixUpdateSchema,
} from "@church/shared";
import type { z } from "zod";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import * as service from "./asset-refs.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });
const idOf = (c: C) => c.req.param("id" as never) as string;

export const bootstrap = async (c: C) => {
  const parishId = c.get("parishId") ?? null;
  const all = c.req.query("all") === "1";
  return c.json(await run(c, (tx) => service.bootstrap(tx, parishId, all)));
};

export const createPrefix = async (c: C, b: z.infer<typeof prefixSchema>) => { const a = actorOf(c); return c.json(await run(c, (tx) => service.createPrefix(tx, a, b)), 201); };
export const updatePrefix = async (c: C, b: z.infer<typeof prefixUpdateSchema>) => { const a = actorOf(c); const id = idOf(c); return c.json(await run(c, (tx) => service.updatePrefix(tx, a, id, b))); };
export const createLocation = async (c: C, b: z.infer<typeof assetLocationSchema>) => { const a = actorOf(c); return c.json(await run(c, (tx) => service.createLocation(tx, a, b)), 201); };
export const updateLocation = async (c: C, b: z.infer<typeof assetLocationUpdateSchema>) => { const a = actorOf(c); const id = idOf(c); return c.json(await run(c, (tx) => service.updateLocation(tx, a, id, b))); };
export const createSupplier = async (c: C, b: z.infer<typeof assetSupplierSchema>) => { const a = actorOf(c); return c.json(await run(c, (tx) => service.createSupplier(tx, a, b)), 201); };
export const updateSupplier = async (c: C, b: z.infer<typeof assetSupplierUpdateSchema>) => { const a = actorOf(c); const id = idOf(c); return c.json(await run(c, (tx) => service.updateSupplier(tx, a, id, b))); };

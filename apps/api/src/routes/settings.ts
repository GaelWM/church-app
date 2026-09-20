import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { settings } from "@church/db";
import type { AppEnv } from "../env";
import { parishScope, requireParish, requirePerm } from "../middleware/auth";
import { audit } from "../services/audit";
import { run } from "../services/run";
import { getSettings, settingsPatchSchema } from "../services/settings";

export const settingsRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/", async (c) => c.json(await run(c, (tx) => getSettings(tx, requireParish(c)))))
  .put("/", requirePerm("config.manage"), zValidator("json", settingsPatchSchema), async (c) => {
    const patch = c.req.valid("json") as Record<string, unknown>;
    const parishId = requireParish(c);
    return c.json(await run(c, async (tx) => {
      const before = await getSettings(tx, parishId);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const [ex] = await tx.select().from(settings).where(and(eq(settings.parishId, parishId), eq(settings.key, key)));
        if (ex) await tx.update(settings).set({ value: value as any, updatedBy: c.get("user").id, updatedAt: new Date() }).where(eq(settings.id, ex.id));
        else await tx.insert(settings).values({ parishId, key, value: value as any, updatedBy: c.get("user").id });
      }
      const after = await getSettings(tx, parishId);
      const keys = Object.keys(patch);
      const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
      await audit(tx, { parishId, actorId: c.get("user").id, action: "settings.update", entity: "settings", before: pick(before), after: pick(after) });
      return after;
    }));
  });

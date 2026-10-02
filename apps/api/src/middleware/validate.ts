import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import type { ValidationTargets } from "hono";

/** Every other error path responds with `{ error: string }` (see index.ts's onError); the zod-validator
 * default hook breaks that contract by returning the raw ZodError instead, which the web client then
 * can't render as a human-readable message. This joins every issue into one readable string so forms
 * can show it like any other API error. */
function issuesMessage(issues: { message: string }[]): string {
  return [...new Set(issues.map((i) => i.message))].join(" ; ");
}

export const zValidator = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  honoZValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: issuesMessage(result.error.issues) }, 400);
  });

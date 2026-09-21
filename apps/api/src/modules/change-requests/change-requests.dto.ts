import type { z } from "zod";
import type { changeRequestDecisionSchema, changeRequestInputSchema, changeRequestRejectSchema } from "@church/shared";

export type ChangeRequestInput = z.infer<typeof changeRequestInputSchema>;
export type ChangeRequestDecisionInput = z.infer<typeof changeRequestDecisionSchema>;
export type ChangeRequestRejectInput = z.infer<typeof changeRequestRejectSchema>;

/** Raw list filters: `status` is a comma-separated list, `mine` restricts to the caller's own requests. */
export type ListQuery = { status?: string; mine: boolean };

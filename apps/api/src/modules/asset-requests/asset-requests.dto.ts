import { z } from "zod";

export const requestListQuerySchema = z.object({
  status: z.string().max(100).optional(),
  kind: z.string().max(100).optional(),
  assetId: z.string().uuid().optional(),
  mine: z.enum(["1", "0"]).optional(),
});
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

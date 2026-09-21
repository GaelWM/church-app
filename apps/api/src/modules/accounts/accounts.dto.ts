import { z } from "zod";

export const accountUpdateSchema = z.object({ name: z.string().optional(), active: z.boolean().optional() });
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

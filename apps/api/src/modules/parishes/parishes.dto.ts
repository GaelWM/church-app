import { z } from "zod";
import { parishSchema } from "@church/shared";

export const parishUpdateSchema = parishSchema.partial().extend({ active: z.boolean().optional() });
export type ParishUpdateInput = z.infer<typeof parishUpdateSchema>;

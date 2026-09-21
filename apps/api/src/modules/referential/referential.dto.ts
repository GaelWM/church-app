import { z } from "zod";

export const categoryCreateSchema = z.object({ kind: z.enum(["recette", "depense", "banque"]), name: z.string().min(1), group: z.string().optional(), fundId: z.string().uuid().optional(), requiresDepartment: z.boolean().optional() });
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.object({ name: z.string().min(1).optional(), group: z.string().optional(), active: z.boolean().optional() });
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

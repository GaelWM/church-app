import { z } from "zod";

export const departmentCreateSchema = z.object({ name: z.string().trim().min(1, "Nom obligatoire").max(100) });
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export const departmentUpdateSchema = departmentCreateSchema;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

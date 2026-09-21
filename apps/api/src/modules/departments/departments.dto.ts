import { z } from "zod";

export const departmentCreateSchema = z.object({ name: z.string().min(1) });
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;

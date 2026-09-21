import type { z } from "zod";
import { userCreateSchema } from "@church/shared";

export const userRolesSchema = userCreateSchema.pick({ roles: true });
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserRolesInput = z.infer<typeof userRolesSchema>;

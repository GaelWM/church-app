import type { z } from "zod";
import { userCreateSchema } from "@church/shared";

export const userRolesSchema = userCreateSchema.pick({ roles: true });
export const userUpdateSchema = userCreateSchema.pick({ email: true, fullName: true }).partial();
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserRolesInput = z.infer<typeof userRolesSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

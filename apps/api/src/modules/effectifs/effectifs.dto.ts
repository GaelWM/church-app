import { z } from "zod";
import { CULTE_TYPES, pastDate, WORKER_CATEGORIES } from "@church/shared";

const count = z.number().int().min(0).max(1_000_000);
export const countsSchema = z.object({ mAdulte: count, mEnfant: count, mBebe: count, fAdulte: count, fEnfant: count, fBebe: count });
export type Counts = z.infer<typeof countsSchema>;
const culte = z.enum(CULTE_TYPES);
const uuid = z.string().uuid();
const opt = z.string().trim().max(300).optional().nullable().transform((v) => v || null);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const attendanceQuerySchema = z.object({ from: isoDay.optional(), to: isoDay.optional(), serviceType: z.string().optional() });
export type AttendanceQuery = z.infer<typeof attendanceQuerySchema>;

export const attendanceSchema = countsSchema.extend({ serviceDate: pastDate, serviceType: culte });
export type AttendanceInput = z.infer<typeof attendanceSchema>;

export const attendanceDaySchema = z.object({
  date: pastDate, cultes: z.array(z.object({ serviceType: culte, counts: countsSchema })).min(1),
});
export type AttendanceDayInput = z.infer<typeof attendanceDaySchema>;

export const attendanceActionSchema = z.object({ comment: z.string().optional() }).optional();
export type AttendanceActionInput = z.infer<typeof attendanceActionSchema>;

export const memberSchema = z.object({ fullName: z.string().trim().min(1, "Nom requis").max(200), address: opt, whatsapp: opt, phone: opt, email: opt, homeChurch: opt, invitedBy: opt });
export type MemberInput = z.infer<typeof memberSchema>;

export const workerSchema = z.object({
  category: z.enum(WORKER_CATEGORIES), fullName: z.string().trim().min(1, "Nom requis").max(200), address: opt,
  departmentId: uuid.optional().nullable().transform((v) => v || null), phone: opt, email: opt, whatsapp: opt,
  basicTeachingDone: z.boolean().default(false), active: z.boolean().default(true),
});
export type WorkerInput = z.infer<typeof workerSchema>;

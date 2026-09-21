import { and, desc, eq, gte, lte } from "drizzle-orm";
import { attendanceRecords, departments, members, workers, type Tx } from "@church/db";
import type { AttendanceQuery, Counts, MemberInput, WorkerInput } from "./effectifs.dto";

// Attendance
export const listAttendance = (tx: Tx, q: AttendanceQuery) => {
  const where = and(q.from ? gte(attendanceRecords.serviceDate, q.from) : undefined, q.to ? lte(attendanceRecords.serviceDate, q.to) : undefined, q.serviceType ? eq(attendanceRecords.serviceType, q.serviceType) : undefined);
  return tx.select().from(attendanceRecords).where(where).orderBy(desc(attendanceRecords.serviceDate), attendanceRecords.serviceType);
};

export async function findAttendanceForDay(tx: Tx, parishId: string, serviceDate: string, serviceType: string) {
  const [ex] = await tx.select().from(attendanceRecords).where(and(eq(attendanceRecords.parishId, parishId), eq(attendanceRecords.serviceDate, serviceDate), eq(attendanceRecords.serviceType, serviceType)));
  return ex;
}

export async function insertAttendance(tx: Tx, parishId: string, actorId: string, serviceDate: string, serviceType: string, n: Counts) {
  const [a] = await tx.insert(attendanceRecords).values({ parishId, serviceDate, serviceType, enteredBy: actorId, ...n }).returning();
  return a!;
}

export async function updateAttendanceCounts(tx: Tx, id: string, n: Counts) {
  const [a] = await tx.update(attendanceRecords).set(n).where(eq(attendanceRecords.id, id)).returning();
  return a!;
}

export async function findAttendance(tx: Tx, id: string) {
  const [a] = await tx.select().from(attendanceRecords).where(eq(attendanceRecords.id, id));
  return a;
}

export async function setAttendanceStatus(tx: Tx, id: string, status: string) {
  const [u] = await tx.update(attendanceRecords).set({ status }).where(eq(attendanceRecords.id, id)).returning();
  return u!;
}

// Members
export const listMembers = (tx: Tx) => tx.select().from(members).orderBy(members.fullName);

export async function insertMember(tx: Tx, parishId: string, b: MemberInput) {
  const [m] = await tx.insert(members).values({ parishId, ...b }).returning();
  return m!;
}

export async function findMember(tx: Tx, id: string, parishId: string) {
  const [old] = await tx.select().from(members).where(and(eq(members.id, id), eq(members.parishId, parishId)));
  return old;
}

export async function updateMember(tx: Tx, id: string, b: MemberInput) {
  const [m] = await tx.update(members).set(b).where(eq(members.id, id)).returning();
  return m!;
}

export async function deleteMember(tx: Tx, id: string, parishId: string) {
  const [old] = await tx.delete(members).where(and(eq(members.id, id), eq(members.parishId, parishId))).returning();
  return old;
}

// Workers
export const listWorkers = (tx: Tx) => tx.select().from(workers).orderBy(workers.fullName);

export async function insertWorker(tx: Tx, parishId: string, b: WorkerInput) {
  const [w] = await tx.insert(workers).values({ parishId, ...b }).returning();
  return w!;
}

export async function findWorker(tx: Tx, id: string, parishId: string) {
  const [old] = await tx.select().from(workers).where(and(eq(workers.id, id), eq(workers.parishId, parishId)));
  return old;
}

export async function updateWorker(tx: Tx, id: string, b: WorkerInput) {
  const [w] = await tx.update(workers).set(b).where(eq(workers.id, id)).returning();
  return w!;
}

export async function deleteWorker(tx: Tx, id: string, parishId: string) {
  const [old] = await tx.delete(workers).where(and(eq(workers.id, id), eq(workers.parishId, parishId))).returning();
  return old;
}

export async function findDepartment(tx: Tx, id: string, parishId: string) {
  const [d] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), eq(departments.parishId, parishId)));
  return d;
}

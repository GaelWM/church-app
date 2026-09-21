import type { Context } from "hono";
import type { TxAction } from "@church/shared";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import type { AttendanceActionInput, AttendanceDayInput, AttendanceInput, AttendanceQuery, MemberInput, WorkerInput } from "./effectifs.dto";
import * as service from "./effectifs.service";
import { assertDistinctCultes } from "./effectifs.service";

type C = Context<AppEnv>;
// `parishId` is a lazy getter so requireParish() fires when the service first needs it, as before the refactor.
const actorOf = (c: C): service.Actor => ({
  userId: c.get("user").id, roles: c.get("roles"),
  get parishId() { return requireParish(c); },
});

export const listAttendance = async (c: C, q: AttendanceQuery) => c.json(await run(c, (tx) => service.listAttendance(tx, q)));

export const saveAttendance = async (c: C, body: AttendanceInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.saveAttendance(tx, actor, body)), 201);
};

export const saveAttendanceDay = async (c: C, body: AttendanceDayInput) => {
  assertDistinctCultes(body);
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.saveAttendanceDay(tx, actor, body)), 201);
};

export const transitionAttendance = async (c: C, body: AttendanceActionInput) => {
  const actor = actorOf(c);
  const action = c.req.param("action") as TxAction;
  return c.json(await run(c, (tx) => service.transitionAttendance(tx, actor, c.req.param("id")!, action, body)));
};

export const listMembers = async (c: C) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.listMembers(tx, actor)));
};

export const createMember = async (c: C, body: MemberInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createMember(tx, actor, body)), 201);
};

export const updateMember = async (c: C, body: MemberInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.updateMember(tx, actor, c.req.param("id")!, body)));
};

export const deleteMember = async (c: C) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.deleteMember(tx, actor, c.req.param("id")!)));
};

export const listWorkers = async (c: C) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.listWorkers(tx, actor)));
};

export const createWorker = async (c: C, body: WorkerInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createWorker(tx, actor, body)), 201);
};

export const updateWorker = async (c: C, body: WorkerInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.updateWorker(tx, actor, c.req.param("id")!, body)));
};

export const deleteWorker = async (c: C) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.deleteWorker(tx, actor, c.req.param("id")!)));
};

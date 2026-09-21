import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { run } from "../../services/run";
import { fileResponse, readUploadedFile } from "../attachments/upload";
import type { CommitmentInput, CommitmentPaidInput, PledgeInput, ReleaseInput } from "./engagements.dto";
import type { Kind } from "./engagements.repo";
import * as service from "./engagements.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: requireParish(c) });

export const listMembers = async (c: C) => c.json(await run(c, service.listMembers));

export const listPledges = async (c: C) => c.json(await run(c, service.listPledges));

export const createPledge = async (c: C, body: PledgeInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createPledge(tx, actor, body)), 201);
};

export const listCommitments = async (c: C) => c.json(await run(c, service.listCommitments));

export const createCommitment = async (c: C, body: CommitmentInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.createCommitment(tx, actor, body)), 201);
};

export const markCommitmentPaid = async (c: C, body: CommitmentPaidInput) => {
  const actor = { userId: c.get("user").id };
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.markCommitmentPaid(tx, actor, id, body.transactionId)));
};

export const summary = async (c: C) => c.json(await run(c, service.summary));

export const listReleases = async (c: C) => {
  const kind = c.req.param("kind") as Kind;
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.listReleases(tx, kind, id)));
};

export const createRelease = async (c: C, body: ReleaseInput) => {
  const kind = c.req.param("kind") as Kind;
  const id = c.req.param("id")!;
  const actor = { userId: c.get("user").id };
  return c.json(await run(c, (tx) => service.createRelease(tx, actor, kind, id, body)), 201);
};

export const attachReleaseFile = async (c: C) => {
  const file = await readUploadedFile(c);
  const actor = { userId: c.get("user").id };
  const id = c.req.param("id")!;
  return c.json(await run(c, (tx) => service.attachReleaseFile(tx, actor, c.env.FILES, id, file)));
};

export const getReleaseFile = async (c: C) => {
  const id = c.req.param("id")!;
  const key = await run(c, (tx) => service.getReleaseFileKey(tx, id));
  return fileResponse(c.env.FILES, key);
};

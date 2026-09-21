import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { run } from "../../services/run";
import * as service from "./attachments.service";
import { fileResponse, readUploadedFile } from "./upload";

type C = Context<AppEnv>;

export const listForTransaction = async (c: C) => {
  const txId = c.req.param("txId")!;
  return c.json(await run(c, (tx) => service.listForTransaction(tx, txId)));
};

export const addToTransaction = async (c: C) => {
  const file = await readUploadedFile(c);
  const actor = { userId: c.get("user").id };
  const txId = c.req.param("txId")!;
  const row = await run(c, (tx) => service.addToTransaction(tx, actor, c.env.FILES, txId, file));
  return c.json(row, 201);
};

export const getFile = async (c: C) => {
  const id = c.req.param("id")!;
  const key = await run(c, (tx) => service.getFileKey(tx, id));
  return fileResponse(c.env.FILES, key);
};

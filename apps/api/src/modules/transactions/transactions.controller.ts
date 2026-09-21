import type { Context } from "hono";
import { rejected } from "@church/emails";
import type { TxAction } from "@church/shared";
import type { AppEnv } from "../../env";
import { requireParish } from "../../middleware/auth";
import { safeSend } from "../../services/mailer";
import { run } from "../../services/run";
import { HTTPException } from "hono/http-exception";
import type { BalanceQuery, BatchBody, Filters, TransactionCreateInput, TransactionPatchInput } from "./transactions.dto";
import * as repo from "./transactions.repo";
import * as service from "./transactions.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ userId: c.get("user").id, parishId: c.get("parishId") ?? undefined, roles: c.get("roles") });

// List with filters (Recettes / Dépenses / Banques menus and the À valider inbox); names of initiator and validators included.
export const list = async (c: C, q: Filters) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.list(tx, actor, q)));
};

// Parish entry settings the forms need (piece number mode).
export const getConfig = async (c: C) => {
  const pid = c.get("parishId");
  const mode = pid ? await run(c, (tx) => service.pieceMode(tx, pid)) : "mixed";
  return c.json({ pieceNumberMode: mode });
};

// People who entered / validated entries (journal Initiateur and Validateur filters).
export const listPeople = async (c: C) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.listPeople(tx, actor)));
};

// Validated balance of one account (low-balance warning on dépense forms).
export const getBalance = async (c: C, q: BalanceQuery) => c.json(await run(c, (tx) => service.getBalance(tx, q)));

export const journal = async (c: C, q: Filters) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.journal(tx, actor, q)));
};

export const getOne = async (c: C) => c.json(await run(c, (tx) => service.getDetail(tx, c.req.param("id")!)));

export const create = async (c: C, b: TransactionCreateInput) => {
  const parishId = requireParish(c);
  if (b.parishId !== parishId) throw new HTTPException(400, { message: "Paroisse incohérente" });
  const actor = { ...actorOf(c), parishId };
  return c.json(await run(c, (tx) => service.create(tx, actor, b)), 201);
};

export const update = async (c: C, b: TransactionPatchInput) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.update(tx, actor, c.req.param("id")!, b)));
};

export const remove = async (c: C) => {
  const actor = actorOf(c);
  await run(c, (tx) => service.remove(tx, actor, c.req.param("id")!));
  return c.body(null, 204);
};

// Batch actions for the À valider inboxes.
export const batch = async (c: C, body: BatchBody) => {
  const action = c.req.param("action") as TxAction;
  const actor = actorOf(c);
  service.assertBatchAllowed(actor.roles, action);
  const results = await run(c, (tx) => service.batch(tx, actor, action, body));
  return c.json({ results });
};

/** Workflow action on one entry; a rejection also emails the author. */
export async function act(c: C, action: TxAction, comment?: string) {
  const actor = actorOf(c);
  const updated = await run(c, (tx) => service.act(tx, actor, c.req.param("id")!, action, comment));
  if (action === "reject") {
    const first = updated[0]!;
    const author = await repo.findUserById(c.get("db"), first.enteredBy);
    if (author) await safeSend(c.get("mailer"), [{ to: author.email, ...rejected({ reference: first.reference, reason: comment ?? "", appUrl: c.env.APP_URL }) }]);
  }
  return c.json(updated);
}

export const reverse = async (c: C, { comment }: { comment: string }) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.reverse(tx, actor, c.req.param("id")!, comment)), 201);
};

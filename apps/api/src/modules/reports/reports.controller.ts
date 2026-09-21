import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { run } from "../../services/run";
import type { ReportQuery } from "./reports.dto";
import * as service from "./reports.service";

type C = Context<AppEnv>;
const actorOf = (c: C): service.Actor => ({ parishId: c.get("parishId") });

export const listUsers = async (c: C) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.listUsers(tx, actor)));
};

export const journal = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.journal(tx, actor, q)));
};

export const recettesParCategorie = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.byCategory(tx, actor, q, "recette")));
};

export const depensesParCategorie = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.byCategory(tx, actor, q, "depense")));
};

export const soldesParCompte = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.soldesParCompte(tx, actor, q)));
};

export const consolide = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.consolide(tx, actor, q)));
};

export const transferts = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.transferts(tx, actor, q)));
};

export const engagements = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.engagements(tx, actor, q)));
};

export const effectifs = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.effectifs(tx, actor, q)));
};

export const membres = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.membres(tx, actor, q)));
};

export const ouvriers = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.ouvriers(tx, actor, q)));
};

export const dedicaces = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.dedicaces(tx, actor, q)));
};

export const baptemes = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.baptemes(tx, actor, q)));
};

export const mariages = async (c: C, q: ReportQuery) => {
  const actor = actorOf(c);
  return c.json(await run(c, (tx) => service.mariages(tx, actor, q)));
};

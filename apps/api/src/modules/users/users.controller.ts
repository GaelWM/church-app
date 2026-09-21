import type { Context } from "hono";
import { invitation, securityAlert } from "@church/emails";
import type { AppEnv } from "../../env";
import { passwordSetLink } from "../../services/auth0";
import { safeSend } from "../../services/mailer";
import { adminParishes, requireAdmin } from "./admin.guard";
import type { UserCreateInput, UserRolesInput } from "./users.dto";
import * as service from "./users.service";

type C = Context<AppEnv>;

async function alertAdmins(c: C, message: string) {
  const admins = await service.listAdminEmails(c.get("db"));
  await safeSend(c.get("mailer"), admins.map((a) => ({ to: a.email, ...securityAlert({ message }) })));
}

export const listUsers = async (c: C) => {
  requireAdmin(c);
  return c.json(await service.listUsers(c.get("db"), adminParishes(c)));
};

export const createUser = async (c: C, b: UserCreateInput) => {
  requireAdmin(c);
  const { user, auth0Id } = await service.createUser(c.get("db"), c.env, c.get("user").id, adminParishes(c), b);
  const link = await passwordSetLink(c.env, auth0Id);
  await safeSend(c.get("mailer"), [{ to: b.email, ...invitation({ fullName: b.fullName, link, appUrl: c.env.APP_URL }) }]);
  return c.json(user, 201);
};

export const updateRoles = async (c: C, { roles }: UserRolesInput) => {
  requireAdmin(c);
  await service.replaceRoles(c.get("db"), c.get("user").id, adminParishes(c), c.req.param("id")!, roles);
  await alertAdmins(c, `Les profils d'un utilisateur ont été modifiés par ${c.get("user").fullName}.`);
  return c.json({ ok: true });
};

export const setActive = async (c: C) => {
  requireAdmin(c);
  const active = c.req.param("state") === "activate";
  const u = await service.setUserActive(c.get("db"), c.env, c.get("user").id, c.req.param("id")!, active);
  if (!active) await alertAdmins(c, `${u.fullName} a été désactivé par ${c.get("user").fullName}.`);
  return c.json({ ok: true });
};

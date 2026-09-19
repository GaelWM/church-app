import type { Db } from "@church/db";
import type { Role } from "@church/shared";
import type { Mailer } from "./services/mailer";

export type Bindings = {
  HYPERDRIVE: { connectionString: string };
  DATABASE_URL?: string;
  AUTH0_DOMAIN: string;
  AUTH0_AUDIENCE: string;
  AUTH0_M2M_CLIENT_ID: string;
  AUTH0_M2M_CLIENT_SECRET: string;
  APP_URL: string;
  /** Local development only: accept "dev:<auth0Id>" tokens. Set in .dev.vars, never in wrangler.jsonc. */
  DEV_AUTH?: string;
  MAIL_FROM: string;
  FILES: R2Bucket;
  KV: KVNamespace;
  EMAIL: { send(msg: { to: string; from: string; subject: string; html: string }): Promise<void> };
};

export type Membership = { parishId: string; role: Role; consolidatedAccess: boolean };

export type Vars = {
  db: Db;
  mailer: Mailer;
  auth0Id: string;
  user: { id: string; email: string; fullName: string };
  memberships: Membership[];
  /** Parish ids visible to this request (RLS scope). */
  parishIds: string[];
  /** Selected parish, or null in consolidated (read-only) mode. */
  parishId: string | null;
  /** Roles held in the selected parish (union across consolidated parishes). */
  roles: Role[];
};

export type AppEnv = { Bindings: Bindings; Variables: Vars };

export type Deps = {
  verifyToken?: (token: string, env: Bindings) => Promise<{ sub: string }>;
  createDb?: (env: Bindings) => Db;
  mailer?: (env: Bindings) => Mailer;
};

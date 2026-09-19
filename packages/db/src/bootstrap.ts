/**
 * Create the first parish and Administrateur (run once per environment).
 * The Auth0 user must already exist (Auth0 dashboard → Users) since sign-up is disabled.
 *   DATABASE_URL=... bun src/bootstrap.ts --parish "Paroisse Centrale" --code KIN01 --email a@b.org --name "Nom" --auth0-id "auth0|abc"
 */
import { createDb } from "./client";
import { requireDatabaseUrl } from "./env";
import { parishes, userParishRoles, users } from "./schema";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`Missing --${n}`);
  return v;
};

const db = createDb(requireDatabaseUrl());
const [p] = await db.insert(parishes).values({ name: arg("parish"), code: arg("code") }).returning();
const [u] = await db.insert(users).values({ auth0Id: arg("auth0-id"), email: arg("email"), fullName: arg("name") }).returning();
await db.insert(userParishRoles).values({ userId: u!.id, parishId: p!.id, role: "administrateur" });
console.log(`Created parish ${p!.code} and administrator ${u!.email}`);
process.exit(0);

/**
 * Create/update the NON-superuser role the Worker connects with, and grant it access.
 * Row-level security only protects data when the connecting role is not a superuser / BYPASSRLS,
 * so the Worker must never use the owner (migration) credentials.
 *
 *   DATABASE_URL=<owner url> APP_DB_PASSWORD=<password> [APP_DB_ROLE=app_user] bun src/grant-app-role.ts
 *
 * Safe to re-run. ALTER DEFAULT PRIVILEGES makes tables/sequences/functions created by *later*
 * migrations (run as the same owner) usable by the app role without another grant.
 */
import postgres from "postgres";
import { requireDatabaseUrl } from "./env";

const role = process.env.APP_DB_ROLE ?? "app_user";
const password = process.env.APP_DB_PASSWORD;
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("APP_DB_ROLE must be a plain lowercase identifier");
if (!password) throw new Error("APP_DB_PASSWORD is required");

const literal = (v: string) => `'${v.replaceAll("'", "''")}'`;
const sql = postgres(requireDatabaseUrl(), { max: 1 });

// Can we log in as the app role with the given password? (used when we may not alter a role we don't administer)
async function appRoleLoginWorks(): Promise<boolean> {
  const url = new URL(requireDatabaseUrl());
  url.username = role;
  url.password = password!;
  const probe = postgres(url.toString(), { max: 1, connect_timeout: 10 });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const [existing] = await sql`select 1 from pg_roles where rolname = ${role}`;
if (!existing) {
  await sql.unsafe(`create role ${role} login password ${literal(password)} nosuperuser nobypassrls nocreatedb nocreaterole`);
} else {
  try {
    // No attribute flags: managed Postgres (Neon) owners are not real superusers, and even
    // "nosuperuser" in ALTER ROLE is rejected for them. The attributes are verified below instead.
    await sql.unsafe(`alter role ${role} login password ${literal(password)}`);
  } catch (e) {
    if ((e as { code?: string }).code !== "42501") throw e;
    // The role was created by another role, so we cannot change its password. That is fine if it already works.
    if (!(await appRoleLoginWorks())) {
      await sql.end();
      console.error(
        [
          `✖ Role "${role}" exists but was created by another role, so it cannot be altered, and APP_DB_PASSWORD does not log in as it.`,
          `  Fix (run once in the Neon SQL editor as the owner role, then re-run):`,
          `    drop owned by ${role};`,
          `    drop role ${role};`,
          `  Or reset ${role}'s password in the Neon console to the value of APP_DB_PASSWORD.`,
        ].join("\n"),
      );
      process.exit(1);
    }
    console.warn(`! Could not alter role "${role}" (created by another role); its existing password matches APP_DB_PASSWORD, continuing.`);
  }
}

const statements = [
  `grant usage on schema public to ${role}`,
  `grant select, insert, update, delete on all tables in schema public to ${role}`,
  `grant usage, select on all sequences in schema public to ${role}`,
  `grant execute on all functions in schema public to ${role}`,
  `alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`,
  `alter default privileges in schema public grant usage, select on sequences to ${role}`,
  `alter default privileges in schema public grant execute on functions to ${role}`,
  // the migration bookkeeping table is not the app's business
  `revoke all on table _migrations from ${role}`,
];

for (const s of statements) await sql.unsafe(s);

// RLS is only enforced for a non-superuser without BYPASSRLS; refuse to continue otherwise.
const [attrs] = await sql`select rolsuper, rolbypassrls from pg_roles where rolname = ${role}`;
if (!attrs || attrs.rolsuper || attrs.rolbypassrls) {
  await sql.end();
  throw new Error(`Role "${role}" is a superuser or has BYPASSRLS, so RLS would not apply. Fix it in the Neon console (or drop the role) and re-run.`);
}
await sql.end();
console.log(`Role "${role}" ready (non-superuser, RLS applies).`);

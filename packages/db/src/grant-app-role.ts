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

const statements = [
  `do $$ begin
     if not exists (select from pg_roles where rolname = ${literal(role)}) then
       create role ${role} login password ${literal(password)} nosuperuser nobypassrls nocreatedb nocreaterole;
     else
       alter role ${role} login password ${literal(password)} nosuperuser nobypassrls nocreatedb nocreaterole;
     end if;
   end $$`,
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
await sql.end();
console.log(`Role "${role}" ready (non-superuser, RLS applies).`);

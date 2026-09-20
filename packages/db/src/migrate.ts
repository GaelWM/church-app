import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { requireDatabaseUrl } from "./env";

// Applies drizzle-generated SQL (0000_*, ...) then hand-written safeguards (9999_*), once each.
const sql = postgres(requireDatabaseUrl(), { max: 1 });
const [who] = await sql`select current_user as role, has_schema_privilege(current_user, 'public', 'CREATE') as can_create`;
if (!who?.can_create) {
  await sql.end();
  const role = who?.role ?? "unknown";
  console.error(
    [
      `✖ DATABASE_URL connects as role "${who?.role ?? "unknown"}", which cannot CREATE in schema public.`,
      "  DATABASE_URL must be the OWNER role's Neon direct URL (e.g. neondb_owner), not app_user.",
      `  Or, as the owner, run: grant create, usage on schema public to ${role};`,
    ].join("\n"),
  );
  process.exit(1);
}
await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`;
const dir = join(import.meta.dir, "../migrations");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const [done] = await sql`select 1 from _migrations where name = ${f}`;
  if (done) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(join(dir, f), "utf8").replaceAll("--> statement-breakpoint", ""));
    await tx`insert into _migrations (name) values (${f})`;
  });
  console.log("applied", f);
}
await sql.end();

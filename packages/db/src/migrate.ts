import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// Applies drizzle-generated SQL (0000_*, ...) then hand-written safeguards (9999_*), once each.
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
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

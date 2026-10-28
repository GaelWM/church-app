import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb, seedDepartmentDefaults } from "@church/db";
import { DEFAULT_DEPARTMENTS } from "@church/shared";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("départements: defaults (Affermissement), list, create, rename", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const names = async (as: string, parish = ids.parishA) => ((await (await call(as, "GET", "/departments", undefined, parish)).json()) as any[]).map((x) => x.name);

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Paroisse A', ${"DA" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Paroisse B', ${"DB" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id;
    const mk = async (key: string, parish: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
    };
    await mk("admin", ids.parishA!, "administrateur"); await mk("caissier", ids.parishA!, "caissier");
    await mk("adminB", ids.parishB!, "administrateur");
    // parish A as seeded before this release: the 13 original departments, one spelled with its accent
    await sql`insert into departments (parish_id, name) select ${ids.parishA!}, unnest(${DEFAULT_DEPARTMENTS.filter((n) => n !== "Affermissement").map((n) => (n === "Ecodim" ? "Écodim" : n))}::text[])`;
    const [db] = await sql`insert into departments (parish_id, name) values (${ids.parishB!}, 'Chorale B') returning id`;
    ids.deptB = db!.id;
    await sql.end();
  });

  test("seedDepartmentDefaults adds only the missing ones (Affermissement), ignoring case and accents; idempotent", async () => {
    const db = createDb(ADMIN_URL!); // superuser: RLS does not apply
    await seedDepartmentDefaults(db, ids.parishA!);
    await seedDepartmentDefaults(db, ids.parishA!);
    await (db as any).$client?.end();
    const list = await names("admin");
    expect(list).toHaveLength(14);
    expect(list).toContain("Affermissement");
    expect(list).toContain("Écodim");
    expect(list).not.toContain("Ecodim");
    // ordered by name (checked on the plain-ASCII names: accents sort differently from one collation to another)
    const ascii = list.filter((n) => /^[A-Z][a-z ]+$/.test(n));
    expect(ascii).toEqual([...ascii].sort());
  });

  test("a new parish gets every default department", async () => {
    const r = await call("admin", "POST", "/parishes", { name: "Nouvelle", code: `N${sfx}` });
    expect(r.status).toBe(201);
    const p = await r.json() as any;
    const list = await names("admin", p.id);
    expect(list.sort()).toEqual([...DEFAULT_DEPARTMENTS].sort());
  });

  test("create: admin only, trimmed, no duplicate up to case and accents", async () => {
    expect((await call("caissier", "POST", "/departments", { name: "Musique" })).status).toBe(403);
    expect((await call("admin", "POST", "/departments", { name: "   " })).status).toBe(400);
    expect((await call("admin", "POST", "/departments", { name: "ecodim" })).status).toBe(409);
    expect((await call("admin", "POST", "/departments", { name: "AFFERMISSEMENT " })).status).toBe(409);
    const c = await call("admin", "POST", "/departments", { name: "  Musique " });
    expect(c.status).toBe(201);
    expect((await c.json() as any).name).toBe("Musique");
  });

  test("rename: admin only, audited, no duplicate, never another parish's department", async () => {
    const all = (await (await call("admin", "GET", "/departments")).json()) as any[];
    const social = all.find((x) => x.name === "Social")!;
    expect((await call("caissier", "PATCH", `/departments/${social.id}`, { name: "Action sociale" })).status).toBe(403);
    expect((await call("admin", "PATCH", `/departments/${social.id}`, { name: "chorale" })).status).toBe(409);
    expect((await call("admin", "PATCH", `/departments/${ids.deptB}`, { name: "Volé" })).status).toBe(404);
    const r = await call("admin", "PATCH", `/departments/${social.id}`, { name: "Action sociale" });
    expect(r.status).toBe(200);
    expect((await r.json() as any).name).toBe("Action sociale");
    expect((await call("admin", "PATCH", `/departments/${social.id}`, { name: "Action Sociale" })).status).toBe(200); // itself is no duplicate
    const sql = postgres(ADMIN_URL!);
    const rows = await sql`select before, after from audit_log where entity_id = ${social.id} and action = 'department.update' order by at`;
    await sql.end();
    expect(rows[0]!.before.name).toBe("Social");
    expect(rows[0]!.after.name).toBe("Action sociale");
  });
});

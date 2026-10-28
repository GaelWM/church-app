import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("utilisateurs: create, update, roles, delete", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const mailer = memoryMailer();
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => mailer });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  // Dev auth on localhost: the Auth0 Management API calls are skipped.
  const env = { APP_URL: "http://localhost:5173", DEV_AUTH: "1", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;
  const email = (k: string) => `${k}-${sfx}@t.org`;
  const lastAudit = async (action: string, entityId: string) => {
    const sql = postgres(ADMIN_URL!);
    const [a] = await sql`select before, after, actor_id from audit_log where action = ${action} and entity_id = ${entityId} order by at desc limit 1`;
    await sql.end();
    return a;
  };

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Paroisse A', ${"UA" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Paroisse B', ${"UB" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id;
    const mk = async (key: string, roles: Array<[string, string]>) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${email(key)}, ${key}) returning id`;
      for (const [parish, role] of roles) await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("admin", [[ids.parishA!, "administrateur"]]); await mk("caissier", [[ids.parishA!, "caissier"]]);
    await mk("adminB", [[ids.parishB!, "administrateur"]]);
    await mk("both", [[ids.parishA!, "caissier"], [ids.parishB!, "caissier"]]);
    await mk("veteran", [[ids.parishA!, "tresorier"]]);
    await sql`insert into exchange_rates (rate_cdf_per_usd, effective_from, set_by) values ('2800', '2020-01-01', ${ids.veteran!})`;
    await sql.end();
  });

  test("create: a new account, then the same email in another casing is refused", async () => {
    const roles = [{ parishId: ids.parishA, role: "caissier", consolidatedAccess: false }];
    const r = await call("admin", "POST", "/users", { email: email("nouveau"), fullName: "Nouveau", roles });
    expect(r.status).toBe(201);
    ids.nouveau = (await json(r)).id;
    const dup = await call("admin", "POST", "/users", { email: email("nouveau").toUpperCase(), fullName: "Doublon", roles });
    expect(dup.status).toBe(409);
  });

  test("update: name and email, audited, admins alerted of the email change", async () => {
    mailer.sent.length = 0;
    const r = await call("admin", "PATCH", `/users/${ids.nouveau}`, { fullName: "Nouveau Nom", email: email("renomme") });
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ fullName: "Nouveau Nom", email: email("renomme") });
    const a = await lastAudit("user.update", ids.nouveau!);
    expect(a!.actor_id).toBe(ids.admin);
    expect(a!.before).toEqual({ email: email("nouveau"), fullName: "Nouveau" });
    expect(a!.after).toEqual({ email: email("renomme"), fullName: "Nouveau Nom" });
    expect(mailer.sent.map((m) => m.to)).toContain(email("admin"));
    // the name alone: no alert
    mailer.sent.length = 0;
    expect((await call("admin", "PATCH", `/users/${ids.nouveau}`, { fullName: "Nouveau" })).status).toBe(200);
    expect(mailer.sent.length).toBe(0);
  });

  test("update: refused for a taken email, a non-administrator and another parish's user", async () => {
    expect((await call("admin", "PATCH", `/users/${ids.nouveau}`, { email: email("caissier") })).status).toBe(409);
    expect((await call("caissier", "PATCH", `/users/${ids.nouveau}`, { fullName: "x" })).status).toBe(403);
    expect((await call("adminB", "PATCH", `/users/${ids.nouveau}`, { fullName: "x" }, ids.parishB)).status).toBe(404);
  });

  test("roles: duplicates refused; an administrator cannot drop their own Administrateur profile", async () => {
    const caissier = { parishId: ids.parishA, role: "caissier", consolidatedAccess: false };
    expect((await call("admin", "PUT", `/users/${ids.nouveau}/roles`, { roles: [caissier, caissier] })).status).toBe(422);
    const r = await call("admin", "PUT", `/users/${ids.admin}/roles`, { roles: [caissier] });
    expect(r.status).toBe(422);
    expect((await json(r)).error).toMatch(/Administrateur/);
    const keep = await call("admin", "PUT", `/users/${ids.admin}/roles`, { roles: [{ ...caissier, role: "administrateur" }, { ...caissier, role: "evangelisation" }] });
    expect(keep.status).toBe(200);
  });

  test("delete: refused for oneself, a user with history and a user of another parish", async () => {
    expect((await call("admin", "DELETE", `/users/${ids.admin}`)).status).toBe(422);
    const vet = await call("admin", "DELETE", `/users/${ids.veteran}`);
    expect(vet.status).toBe(409);
    expect((await json(vet)).error).toMatch(/désactivez/);
    expect((await call("adminB", "DELETE", `/users/${ids.admin}`, undefined, ids.parishB)).status).toBe(404);
    expect((await call("admin", "DELETE", `/users/${ids.both}`)).status).toBe(403);
    const list = (await json(await call("admin", "GET", "/users"))).map((u: any) => u.id);
    expect(list).toContain(ids.veteran); expect(list).toContain(ids.both);
  });

  test("delete: an account without history is removed, audited and still named in the audit log", async () => {
    mailer.sent.length = 0;
    const r = await call("admin", "DELETE", `/users/${ids.nouveau}`);
    expect(r.status).toBe(204);
    const list = (await json(await call("admin", "GET", "/users"))).map((u: any) => u.id);
    expect(list).not.toContain(ids.nouveau);
    const a = await lastAudit("user.delete", ids.nouveau!);
    expect(a!.actor_id).toBe(ids.admin);
    expect(a!.before.email).toBe(email("renomme"));
    expect(mailer.sent.map((m) => m.to)).toContain(email("admin"));
    const log = await json(await call("admin", "GET", "/audit"));
    expect(log.find((e: any) => e.action === "user.delete" && e.entityId === ids.nouveau).targetName).toBe("Nouveau");
    expect((await call("admin", "DELETE", `/users/${ids.nouveau}`)).status).toBe(404);
  });

  test("an account with only audit entries is kept", async () => {
    const sql = postgres(ADMIN_URL!);
    const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`actor-${sfx}`}, ${email("actor")}, 'actor') returning id`;
    await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${ids.parishA!}, 'evangelisation')`;
    await sql`insert into audit_log (actor_id, action, entity) values (${u!.id}, 'category.create', 'category')`;
    await sql.end();
    expect((await call("admin", "DELETE", `/users/${u!.id}`)).status).toBe(409);
  });
});

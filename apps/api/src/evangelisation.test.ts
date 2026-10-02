import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Évangélisation profile: menu-equivalent permission boundaries", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};

  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json", "x-parish-id": ids.parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [p] = await sql`insert into parishes (name, code) values ('Paroisse Evang', ${"E" + sfx}) returning id`;
    ids.parish = p!.id;
    const mk = async (key: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${ids.parish!}, ${role})`;
      ids[`tok_${key}`] = `${key}-${sfx}`;
    };
    await mk("evang", "evangelisation");
    await mk("caiss", "caissier");
    await sql.end();
  });

  test("blocked from financial reads even though no route previously enforced this", async () => {
    for (const path of ["/transactions", "/transactions/journal", "/transactions/balance", "/dashboard", "/banking/periods", "/engagements/pledges", "/engagements/commitments", "/engagements/summary"]) {
      expect((await call(ids.tok_evang!, "GET", path)).status).toBe(403);
    }
  });

  test("blocked from entering or validating financial transactions", async () => {
    expect((await call(ids.tok_evang!, "POST", "/transactions", { kind: "depense" })).status).toBe(403);
  });

  test("still allowed on its four registers (menu-equivalent access)", async () => {
    expect((await call(ids.tok_evang!, "GET", "/effectifs/members")).status).toBe(200);
    expect((await call(ids.tok_evang!, "GET", "/effectifs/newcomers")).status).toBe(200);
    expect((await call(ids.tok_evang!, "GET", "/effectifs/workers")).status).toBe(200);
    expect((await call(ids.tok_evang!, "GET", "/registres/dedications")).status).toBe(200);
    expect((await call(ids.tok_evang!, "GET", "/registres/marriages")).status).toBe(200);
    expect((await call(ids.tok_evang!, "GET", "/registres/baptisms")).status).toBe(200);
    const created = await call(ids.tok_evang!, "POST", "/effectifs/newcomers", { fullName: "Jean Nouveau" });
    expect(created.status).toBe(201);
  });

  test("existing roles are unaffected by the new read-gating (zero regression)", async () => {
    expect((await call(ids.tok_caiss!, "GET", "/transactions")).status).toBe(200);
    expect((await call(ids.tok_caiss!, "GET", "/dashboard")).status).toBe(200);
  });
});

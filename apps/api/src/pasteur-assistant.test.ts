import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Pasteur assistant profile: no financial access, hence no account balance", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};

  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": ids.parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [p] = await sql`insert into parishes (name, code) values ('Paroisse Assistant', ${"PA" + sfx}) returning id`;
    ids.parish = p!.id;
    const mk = async (key: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${ids.parish!}, ${role})`;
    };
    await mk("assistant", "pasteur_assistant");
    await mk("evang", "evangelisation");
    await mk("caiss", "caissier");
    await mk("admin", "administrateur");
    await sql.end();
  });

  test("blocked from every screen that shows balances or other financial data", async () => {
    for (const path of [
      "/transactions", "/transactions/journal", "/transactions/balance", "/dashboard", "/banking/periods",
      "/engagements/pledges", "/engagements/commitments", "/engagements/summary",
      "/reports/soldes-par-compte", "/reports/consolide", "/reports/journal", "/reports/baptemes",
      "/budget/summary", "/immobilisations", "/audit",
      "/attachments/transaction/00000000-0000-0000-0000-000000000000",
    ]) {
      expect({ path, status: (await call("assistant", "GET", path)).status }).toEqual({ path, status: 403 });
    }
    expect((await call("assistant", "POST", "/transactions", { kind: "depense" })).status).toBe(403);
    expect((await call("assistant", "PUT", "/settings", { backup_note: "x" })).status).toBe(403);
  });

  test("allowed on Effectifs and the registers it validates", async () => {
    for (const path of ["/effectifs/attendance", "/effectifs/members", "/effectifs/newcomers", "/effectifs/workers", "/registres/baptisms", "/registres/marriages", "/registres/dedications", "/departments"]) {
      expect({ path, status: (await call("assistant", "GET", path)).status }).toEqual({ path, status: 200 });
    }
    const me = await (await call("assistant", "GET", "/me")).json() as any;
    expect(me.permissions.pasteur_assistant).toEqual(["registry.write", "registry.validate1"]);
  });

  test("transaction receipts are no longer readable by the no-finance profiles; finance roles unaffected", async () => {
    const path = "/attachments/transaction/00000000-0000-0000-0000-000000000000";
    expect((await call("evang", "GET", path)).status).toBe(403);
    expect((await call("caiss", "GET", path)).status).not.toBe(403);
    expect((await call("admin", "GET", path)).status).not.toBe(403);
  });

  test("low-balance alert recipients never include a no-finance profile, and the extra emails are kept", async () => {
    const r = await call("admin", "PUT", "/settings", { alert_recipients: { roles: ["tresorier", "pasteur_assistant", "evangelisation"], extra_emails: ["compta@t.org"] } });
    expect(r.status).toBe(200);
    const s = await (await call("admin", "GET", "/settings")).json() as any;
    expect(s.alert_recipients).toEqual({ roles: ["tresorier"], extra_emails: ["compta@t.org"] });
  });
});

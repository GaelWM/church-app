import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Effectifs, membres, ouvriers", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) =>
    app.request(`/api/effectifs${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;
  const n = (v: number) => ({ mAdulte: v, mEnfant: 1, mBebe: 2, fAdulte: v, fEnfant: 3, fBebe: 4 });
  const DAY = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Paroisse A', ${"EA" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Paroisse B', ${"EB" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id;
    const mk = async (key: string, parish: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
    };
    await mk("caissier", ids.parishA!, "caissier"); await mk("caissier2", ids.parishA!, "caissier");
    await mk("tresorier", ids.parishA!, "tresorier"); await mk("auditeur", ids.parishA!, "auditeur"); await mk("caissierB", ids.parishB!, "caissier");
    const [dept] = await sql`insert into departments (parish_id, name) values (${ids.parishB!}, 'Chorale B') returning id`;
    ids.deptB = dept!.id;
    await sql.end();
  });

  test("bulk day save, totals, upsert of own draft, duplicate refusal", async () => {
    const r = await call("caissier", "POST", "/attendance/day", { date: DAY, cultes: [{ serviceType: "1er culte", counts: n(10) }, { serviceType: "Écodim", counts: n(5) }] });
    expect(r.status).toBe(201);
    const rows = await json(r);
    expect(rows).toHaveLength(2);
    const list = await json(await call("caissier", "GET", `/attendance?from=${DAY}&to=${DAY}`));
    const tot = list.reduce((s: number, a: any) => s + a.mAdulte + a.mEnfant + a.mBebe + a.fAdulte + a.fEnfant + a.fBebe, 0);
    expect(tot).toBe(10 + 1 + 2 + 10 + 3 + 4 + 5 + 1 + 2 + 5 + 3 + 4);
    // re-saving own draft updates in place (no duplicate row)
    expect((await call("caissier", "POST", "/attendance", { serviceDate: DAY, serviceType: "1er culte", ...n(20) })).status).toBe(201);
    const again = await json(await call("caissier", "GET", `/attendance?serviceType=${encodeURIComponent("1er culte")}&from=${DAY}&to=${DAY}`));
    expect(again).toHaveLength(1); expect(again[0].mAdulte).toBe(20);
    // another author cannot create a duplicate
    const dup = await call("caissier2", "POST", "/attendance", { serviceDate: DAY, serviceType: "1er culte", ...n(1) });
    expect(dup.status).toBe(422);
    // duplicate culte inside one bulk request
    expect((await call("caissier", "POST", "/attendance/day", { date: DAY, cultes: [{ serviceType: "Écodim", counts: n(1) }, { serviceType: "Écodim", counts: n(1) }] })).status).toBe(422);
    // unknown culte type
    expect((await call("caissier", "POST", "/attendance", { serviceDate: DAY, serviceType: "Inconnu", ...n(1) })).status).toBe(400);
  });

  test("workflow: author cannot validate, treasurer validates, submitted rows are locked", async () => {
    const list = await json(await call("caissier", "GET", `/attendance?from=${DAY}&to=${DAY}&serviceType=${encodeURIComponent("Écodim")}`));
    const id = list[0].id;
    expect((await call("caissier", "POST", `/attendance/${id}/submit`, {})).status).toBe(200);
    expect([403, 422]).toContain((await call("caissier", "POST", `/attendance/${id}/validate1`, {})).status);
    const v = await call("tresorier", "POST", `/attendance/${id}/validate1`, {});
    expect(v.status).toBe(200); expect((await json(v)).status).toBe("validee1");
    // locked: cannot be edited once submitted
    expect((await call("caissier", "POST", "/attendance", { serviceDate: DAY, serviceType: "Écodim", ...n(99) })).status).toBe(422);
  });

  test("members: caissier CRUD, auditeur read-only, parish isolation", async () => {
    const created = await call("caissier", "POST", "/members", { fullName: "Jean Test", whatsapp: "+243", homeChurch: "Église X", invitedBy: "Marie" });
    expect(created.status).toBe(201);
    const m = await json(created);
    expect((await call("caissier", "PUT", `/members/${m.id}`, { fullName: "Jean T.", address: "Av. 1" })).status).toBe(200);
    expect((await json(await call("auditeur", "GET", "/members"))).some((x: any) => x.id === m.id)).toBe(true);
    expect((await call("auditeur", "POST", "/members", { fullName: "X" })).status).toBe(403);
    expect((await call("auditeur", "PUT", `/members/${m.id}`, { fullName: "X" })).status).toBe(403);
    expect((await call("auditeur", "DELETE", `/members/${m.id}`)).status).toBe(403);
    expect((await json(await call("caissierB", "GET", "/members", undefined, ids.parishB))).some((x: any) => x.id === m.id)).toBe(false);
    expect((await call("caissierB", "PUT", `/members/${m.id}`, { fullName: "Hack" }, ids.parishB)).status).toBe(404);
    expect((await call("caissier", "DELETE", `/members/${m.id}`)).status).toBe(200);
  });

  test("workers: caissier CRUD, department must belong to the parish, auditeur read-only, isolation", async () => {
    const bad = await call("caissier", "POST", "/workers", { category: "ouvrier", fullName: "Paul", departmentId: ids.deptB });
    expect(bad.status).toBe(422);
    const ok = await call("caissier", "POST", "/workers", { category: "pasteur", fullName: "Pasteur Luc", basicTeachingDone: true });
    expect(ok.status).toBe(201);
    const w = await json(ok);
    expect(w.basicTeachingDone).toBe(true);
    expect((await call("caissier", "PUT", `/workers/${w.id}`, { category: "chef_departement", fullName: "Luc", active: false })).status).toBe(200);
    expect((await call("caissier", "POST", "/workers", { category: "bidon", fullName: "Z" })).status).toBe(400);
    expect((await call("auditeur", "POST", "/workers", { category: "ouvrier", fullName: "Z" })).status).toBe(403);
    expect((await json(await call("auditeur", "GET", "/workers"))).some((x: any) => x.id === w.id)).toBe(true);
    expect((await json(await call("caissierB", "GET", "/workers", undefined, ids.parishB))).some((x: any) => x.id === w.id)).toBe(false);
    expect((await call("caissierB", "DELETE", `/workers/${w.id}`, undefined, ids.parishB)).status).toBe(404);
    expect((await call("caissier", "DELETE", `/workers/${w.id}`)).status).toBe(200);
  });

  test("attendance is isolated per parish and auditeur cannot write", async () => {
    expect((await json(await call("caissierB", "GET", `/attendance?from=${DAY}&to=${DAY}`, undefined, ids.parishB)))).toHaveLength(0);
    expect((await call("auditeur", "POST", "/attendance", { serviceDate: DAY, serviceType: "2e culte", ...n(1) })).status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("registres (dédicaces, baptêmes, mariages)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const store = new Map<string, { body: ArrayBuffer; type: string }>();
  const FILES = {
    put: async (k: string, b: ArrayBuffer, o: any) => { store.set(k, { body: b, type: o?.httpMetadata?.contentType }); },
    get: async (k: string) => { const v = store.get(k); return v ? { body: v.body, httpMetadata: { contentType: v.type } } : null; },
    delete: async (k: string) => { store.delete(k); },
  };
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) =>
    app.request(`/api/registres${path}`, { method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": parish! }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const upload = (as: string, path: string, file: File, parish = ids.parishA) => {
    const fd = new FormData(); fd.set("file", file);
    return app.request(`/api/registres${path}`, { method: "POST", headers: { authorization: `Bearer ${as}-${sfx}`, "x-parish-id": parish! }, body: fd }, env);
  };
  const png = () => new File([new Uint8Array([1, 2, 3])], "form.png", { type: "image/png" });

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Paroisse A', ${"RA" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Paroisse B', ${"RB" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id;
    const mk = async (key: string, parish: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("caissier", ids.parishA!, "caissier"); await mk("pasteur", ids.parishA!, "pasteur");
    await mk("tresorier", ids.parishA!, "tresorier"); await mk("auditeur", ids.parishA!, "auditeur");
    await mk("caissierB", ids.parishB!, "caissier");
    await sql.end();
  });

  const dedic = { date: "2026-03-01", childName: "Baraka", motherName: "Marie", fatherName: "Jean", pastorName: "Past. Paul", formCompleted: true };

  test("caissier and pasteur create; trésorier/auditeur read but cannot write", async () => {
    expect((await call("caissier", "POST", "/dedications", dedic)).status).toBe(201);
    expect((await call("pasteur", "POST", "/baptisms", { fullName: "Ruth", date: "2026-02-01", email: "" })).status).toBe(201);
    expect((await call("caissier", "POST", "/marriages", { husbandName: "A", wifeName: "B", date: "2026-01-10" })).status).toBe(201);
    for (const r of ["tresorier", "auditeur"]) {
      const l = await call(r, "GET", "/dedications");
      expect(l.status).toBe(200);
      expect((await l.json() as any[]).length).toBeGreaterThan(0);
      expect((await call(r, "POST", "/dedications", dedic)).status).toBe(403);
      expect((await upload(r, "/dedications/00000000-0000-0000-0000-000000000000/files", png())).status).toBe(403);
    }
  });

  test("validation: missing name, absurd future date, unknown register", async () => {
    expect((await call("caissier", "POST", "/dedications", { ...dedic, childName: "" })).status).toBe(400);
    expect((await call("caissier", "POST", "/dedications", { ...dedic, date: "2099-01-01" })).status).toBe(400);
    expect((await call("caissier", "GET", "/nope")).status).toBe(404);
  });

  test("filters, edit, parish isolation", async () => {
    const list = await (await call("caissier", "GET", "/dedications?q=bara&from=2026-01-01&to=2026-12-31&pastor=paul")).json() as any[];
    expect(list.length).toBe(1);
    expect((await (await call("caissier", "GET", "/dedications?q=zzz")).json() as any[]).length).toBe(0);
    const id = list[0].id;
    const p = await call("caissier", "PATCH", `/dedications/${id}`, { formCompleted: false });
    expect((await p.json() as any).formCompleted).toBe(false);
    expect((await call("caissierB", "GET", "/dedications", undefined, ids.parishB)).status).toBe(200);
    expect((await (await call("caissierB", "GET", "/dedications", undefined, ids.parishB)).json() as any[]).length).toBe(0);
    const p2 = await (await call("caissier", "PATCH", `/dedications/${id}`, { formCompleted: true })).json() as any;
    expect((await (await call("caissier", "PATCH", `/dedications/${id}`, { childName: "Baraka" })).json() as any).formCompleted).toBe(p2.formCompleted);
    expect((await (await call("caissier", "GET", "/dedications?q=bara")).json() as any[])[0].motherName).toBe("Marie"); // partial PATCH keeps other fields
    expect((await call("caissierB", "PATCH", `/dedications/${id}`, { childName: "X" }, ids.parishB)).status).toBe(404);
  });

  test("files: upload validation, download, isolation, delete cascade, audit", async () => {
    const rec = await (await call("caissier", "POST", "/baptisms", { fullName: "Samuel", date: "2026-02-02" })).json() as any;
    const base = `/baptisms/${rec.id}/files`;
    expect((await upload("caissier", base, new File(["x"], "a.exe", { type: "application/x-msdownload" }))).status).toBe(415);
    expect((await upload("caissier", base, new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }))).status).toBe(413);
    const up = await upload("caissier", base, png());
    expect(up.status).toBe(201);
    const f = await up.json() as any;
    expect(f.r2Key).toContain(`${ids.parishA}/registres/baptisms/${rec.id}/`);
    expect((await (await call("tresorier", "GET", base)).json() as any[]).length).toBe(1);
    const dl = await call("tresorier", "GET", `/files/${f.id}?download=1`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("image/png");
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect((await call("caissierB", "GET", `/files/${f.id}`, undefined, ids.parishB)).status).toBe(404);
    expect((await upload("caissierB", base, png(), ids.parishB)).status).toBe(404);
    const listed = await (await call("caissier", "GET", "/baptisms?q=samuel")).json() as any[];
    expect(listed[0].fileCount).toBe(1);

    expect((await call("tresorier", "DELETE", `/baptisms/${rec.id}`)).status).toBe(403);
    expect((await call("caissier", "DELETE", `/baptisms/${rec.id}`)).status).toBe(204);
    expect(store.size).toBe(0);
    expect((await call("caissier", "GET", `/files/${f.id}`)).status).toBe(404);

    const sql = postgres(ADMIN_URL!);
    const rows = await sql`select action, before from audit_log where parish_id = ${ids.parishA!} and entity_id = ${rec.id} order by at`;
    await sql.end();
    expect(rows.map((r) => r.action)).toContain("baptism.create");
    const del = rows.find((r) => r.action === "baptism.delete")!;
    expect(del.before.fullName).toBe("Samuel");
  });

  test("delete a single file is audited", async () => {
    const rec = await (await call("pasteur", "POST", "/marriages", { husbandName: "H", wifeName: "W", date: "2026-01-01" })).json() as any;
    const f = await (await upload("pasteur", `/marriages/${rec.id}/files`, png())).json() as any;
    expect((await call("pasteur", "DELETE", `/files/${f.id}`)).status).toBe(204);
    const sql = postgres(ADMIN_URL!);
    const rows = await sql`select 1 from audit_log where entity_id = ${f.id} and action = 'registry.file.delete'`;
    await sql.end();
    expect(rows.length).toBe(1);
  });
});

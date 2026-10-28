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
    await mk("assistant", ids.parishA!, "pasteur_assistant"); await mk("evang", ids.parishA!, "evangelisation");
    // Not assignable through the API (conflicting roles), but the circuit must still require two people.
    await mk("both", ids.parishA!, "pasteur_assistant");
    await sql`insert into user_parish_roles (user_id, parish_id, role) values (${ids.both!}, ${ids.parishA!}, 'pasteur')`;
    await sql.end();
  });
  const json = async (r: Response) => r.json() as Promise<any>;
  const act = (as: string, path: string, action: string, comment?: string) => call(as, "POST", `${path}/${action}`, comment === undefined ? {} : { comment });

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

  test("marriages: godparent fields round-trip, dedication pastor name is free text", async () => {
    const m = await (await call("caissier", "POST", "/marriages", { husbandName: "H2", wifeName: "W2", date: "2026-01-10", godfatherName: "Parrain P", godmotherName: "Marraine M" })).json() as any;
    expect(m.godfatherName).toBe("Parrain P");
    expect(m.godmotherName).toBe("Marraine M");
    // Dédicace: "Nom du pasteur officiant" accepts any free text, not just a registered pasteur user.
    const d = await (await call("caissier", "POST", "/dedications", { ...dedic, pastorName: "Pasteur invité (hors système)" })).json() as any;
    expect(d.pastorName).toBe("Pasteur invité (hors système)");
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

  // ---- circuit Pasteur assistant → Pasteur titulaire (baptêmes, mariages) -------------------------------

  test("baptêmes and mariages start as drafts; dédicaces have no circuit", async () => {
    const b = await json(await call("evang", "POST", "/baptisms", { fullName: "Draft", date: "2026-02-01" }));
    expect(b.status).toBe("brouillon");
    const dd = await json(await call("evang", "POST", "/dedications", dedic));
    expect(dd.status).toBeUndefined();
    expect((await act("evang", `/dedications/${dd.id}`, "submit")).status).toBe(404);
  });

  test("full circuit: author submits, Pasteur assistant then Pasteur titulaire sign; the entry is frozen once submitted", async () => {
    const m = await json(await call("evang", "POST", "/marriages", { husbandName: "Époux", wifeName: "Épouse", date: "2026-03-01" }));
    const path = `/marriages/${m.id}`;
    // a draft belongs to its author
    expect((await call("caissier", "PATCH", path, { husbandName: "X" })).status).toBe(422);
    expect((await call("caissier", "DELETE", path)).status).toBe(422);
    expect((await act("caissier", path, "submit")).status).toBe(422);
    expect((await act("tresorier", path, "submit")).status).toBe(403);
    const s1 = await json(await act("evang", path, "submit"));
    expect(s1.status).toBe("soumise"); expect(s1.submittedAt).toBeTruthy();
    expect((await call("evang", "PATCH", path, { husbandName: "Changé" })).status).toBe(422);
    for (const r of ["tresorier", "pasteur", "evang", "auditeur"]) expect((await act(r, path, "validate1")).status).toBe(403);
    const v1 = await json(await act("assistant", path, "validate1"));
    expect(v1.status).toBe("validee1"); expect(v1.validator1Id).toBe(ids.assistant);
    expect((await act("assistant", path, "validate2")).status).toBe(403);
    const v2 = await json(await act("pasteur", path, "validate2"));
    expect(v2.status).toBe("validee"); expect(v2.validator2Id).toBe(ids.pasteur);
    expect((await act("pasteur", path, "validate2")).status).toBe(422);
    expect((await call("evang", "DELETE", path)).status).toBe(422);
    // certificates often arrive late: a file can still be attached, but not removed
    const f = await json(await upload("evang", `${path}/files`, png()));
    expect((await call("evang", "DELETE", `/files/${f.id}`)).status).toBe(422);
    const listed = (await json(await call("caissier", "GET", "/marriages?status=validee"))).find((x: any) => x.id === m.id);
    expect(listed).toMatchObject({ createdByName: "evang", validator1Name: "assistant", validator2Name: "pasteur", fileCount: 1 });
    expect((await json(await call("caissier", "GET", "/marriages?status=soumise"))).some((x: any) => x.id === m.id)).toBe(false);
    expect(await json(await call("caissier", "GET", "/marriages?status=none"))).toEqual([]);
    // the database refuses a direct change to a validated entry
    const sql = postgres(ADMIN_URL!);
    // postgres.js queries only run once .then() is called, which expect().rejects does not do
    const error = (q: PromiseLike<unknown>) => q.then(() => "aucune erreur", (e: Error) => e.message);
    expect(await error(sql`update marriages set husband_name = 'Forcé' where id = ${m.id}`)).toContain("modification interdite");
    expect(await error(sql`update marriages set status = 'brouillon' where id = ${m.id}`)).toContain("renvoyé en correction");
    const audit = await sql`select action from audit_log where entity_id = ${m.id} order by at`;
    await sql.end();
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["marriage.submit", "marriage.validate1", "marriage.validate2"]));
  });

  test("rejection motif is shown to the author and cleared on resubmission; the titulaire can send back for correction", async () => {
    const b = await json(await call("evang", "POST", "/baptisms", { fullName: "Rejet", date: "2026-03-02" }));
    const path = `/baptisms/${b.id}`;
    await act("evang", path, "submit");
    expect((await act("assistant", path, "reject")).status).toBe(422);
    const r1 = await json(await act("assistant", path, "reject", "Date à vérifier"));
    expect(r1.status).toBe("rejetee"); expect(r1.rejectionReason).toBe("Date à vérifier");
    expect((await call("evang", "PATCH", path, { date: "2026-03-03" })).status).toBe(200);
    const s2 = await json(await act("evang", path, "submit"));
    expect(s2.status).toBe("soumise"); expect(s2.rejectionReason).toBeNull();
    await act("assistant", path, "validate1");
    expect((await json(await act("pasteur", path, "reject", "Nom incomplet"))).status).toBe("rejetee");
    await act("evang", path, "submit");
    await act("assistant", path, "validate1");
    expect((await json(await act("pasteur", path, "validate2"))).status).toBe("validee");
    // Renvoyer en correction: titulaire only, with a motif; the author then corrects and resubmits through both levels
    expect((await act("assistant", path, "reopen", "x")).status).toBe(403);
    expect((await act("pasteur", path, "reopen")).status).toBe(422);
    const re = await json(await act("pasteur", path, "reopen", "Faute dans le nom"));
    expect(re.status).toBe("rejetee"); expect(re.rejectionReason).toBe("Faute dans le nom");
    expect((await call("evang", "PATCH", path, { fullName: "Rejet corrigé" })).status).toBe(200);
    expect((await json(await act("evang", path, "submit"))).validator1Id).toBeNull();
  });

  test("creator-skip: an assistant's entry goes to the titulaire alone; a titulaire's entry is final after the assistant", async () => {
    const a = await json(await call("assistant", "POST", "/baptisms", { fullName: "Par l'assistant", date: "2026-03-04" }));
    const sa = await json(await act("assistant", `/baptisms/${a.id}`, "submit"));
    expect(sa).toMatchObject({ status: "validee1", n1Skipped: true, n2Skipped: false });
    expect((await json(await act("pasteur", `/baptisms/${a.id}`, "validate2"))).status).toBe("validee");

    const p = await json(await call("pasteur", "POST", "/marriages", { husbandName: "P", wifeName: "Q", date: "2026-03-04" }));
    const sp = await json(await act("pasteur", `/marriages/${p.id}`, "submit"));
    expect(sp).toMatchObject({ status: "soumise", n1Skipped: false, n2Skipped: true });
    const fin = await json(await act("assistant", `/marriages/${p.id}`, "validate1"));
    expect(fin.status).toBe("validee"); expect(fin.validator2Id).toBeNull();

    const both = await json(await call("both", "POST", "/baptisms", { fullName: "Cumul", date: "2026-03-04" }));
    expect((await act("both", `/baptisms/${both.id}`, "submit")).status).toBe(422);
  });

  test("the two levels are signed by two different people; other parishes cannot act", async () => {
    const b = await json(await call("evang", "POST", "/baptisms", { fullName: "Deux signatures", date: "2026-03-05" }));
    const path = `/baptisms/${b.id}`;
    await act("evang", path, "submit");
    expect((await call("caissierB", "POST", `${path}/submit`, {}, ids.parishB)).status).toBe(404);
    expect((await json(await act("both", path, "validate1"))).status).toBe("validee1");
    expect((await act("both", path, "validate2")).status).toBe(422);
    expect((await json(await act("pasteur", path, "validate2"))).status).toBe("validee");
  });

  test("pastors dropdown lists the active Pasteurs titulaires and assistants of the parish, once each", async () => {
    const sql = postgres(ADMIN_URL!);
    const [u] = await sql`insert into users (auth0_id, email, full_name, active) values (${`gone-${sfx}`}, ${`gone-${sfx}@t.org`}, 'Pasteur inactif', false) returning id`;
    await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${ids.parishA!}, 'pasteur')`;
    await sql.end();
    for (const r of ["caissier", "auditeur"]) {
      const res = await call(r, "GET", "/pastors");
      expect(res.status).toBe(200);
      expect((await res.json() as any[]).map((p) => p.fullName)).toEqual(["assistant", "both", "pasteur"]);
    }
    // parish B has no pastor
    expect((await (await call("caissierB", "GET", "/pastors", undefined, ids.parishB)).json()) as any[]).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb, seedAssetDefaults } from "@church/db";
import { codePeriod, localIsoDate, reportParEtat, reportVnc, toReportRow, type AssetReportSource } from "@church/shared";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Immobilisations (real Postgres)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  // A second app opens a new connection per request, so concurrent requests really run concurrently in Postgres.
  const extraDbs: any[] = [];
  const concurrentApp = createApp({
    verifyToken: async (t) => ({ sub: t }), mailer: () => memoryMailer(),
    createDb: () => { const x = APP_URL ? createDb(APP_URL) : (undefined as never); extraDbs.push(x); return x; },
  });
  let admin: ReturnType<typeof postgres>;
  afterAll(async () => {
    await (sharedDb as any).$client?.end();
    for (const x of extraDbs) await x.$client?.end();
    await admin?.end();
  });
  // A tiny in-memory R2: just enough for put / get / delete.
  const bucket = new Map<string, { body: ArrayBuffer; httpMetadata?: { contentType?: string } }>();
  const FILES = {
    put: async (k: string, body: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) => { bucket.set(k, { body, httpMetadata: o?.httpMetadata }); },
    get: async (k: string) => bucket.get(k) ?? null,
    delete: async (k: string) => { bucket.delete(k); },
  };
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const TODAY = localIsoDate();
  const PERIOD = codePeriod();

  const send = async (target: typeof app, as: string, method: string, path: string, body?: unknown, parish = ids.parishA): Promise<Response> =>
    target.request(`/api/immobilisations${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) => send(app, as, method, path, body, parish);
  const json = async (r: Response) => r.json() as Promise<any>;
  const upload = async (as: string, id: string, file: File, parish = ids.parishA): Promise<Response> => {
    const form = new FormData();
    form.set("file", file);
    return app.request(`/api/immobilisations/${id}/files`, { method: "POST", headers: { authorization: `Bearer ${as}-${sfx}`, "x-parish-id": parish! }, body: form }, env);
  };

  /** A valid draft payload for parish A; override any field. */
  const draft = (o: Record<string, unknown> = {}) => ({
    acronym: "MI", accountCode: "24", subaccountCode: "24.5", description: "Ordinateur portable",
    acquisitionDate: TODAY, inServiceDate: TODAY, locationId: ids.locAdmin, currency: "USD",
    paMinor: "100000", faaMinor: "5000", method: "lineaire", usefulLifeYears: 5, ...o,
  });
  const mkDraft = async (o: Record<string, unknown> = {}, as = "admin") => {
    const r = await call(as, "POST", "", draft(o));
    expect(r.status).toBe(201);
    return json(r);
  };
  const approve1 = (id: string, as = "tresorier") => call(as, "POST", `/requests/${id}/approve1`);
  const approve2 = (id: string, as = "pasteur") => call(as, "POST", `/requests/${id}/approve2`);
  /** Registers, submits and fully approves an asset (administrateur → Trésorier → Pasteur). */
  const mkActive = async (o: Record<string, unknown> = {}) => {
    const a = await mkDraft(o);
    const sub = await json(await call("admin", "POST", `/${a.id}/submit`));
    expect((await approve1(sub.request.id)).status).toBe(200);
    expect((await approve2(sub.request.id)).status).toBe(200);
    return json(await call("admin", "GET", `/${a.id}`));
  };
  const request = async (as: string, id: string, body: unknown) => call(as, "POST", `/${id}/requests`, body);
  const sqlRows = async (q: string, params: any[] = []) => admin.unsafe(q, params) as Promise<any[]>;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL!);
    const adminDb = createDb(ADMIN_URL!);
    const [pa] = await admin`insert into parishes (name, code) values ('Immo A', ${"IA" + sfx}) returning id`;
    const [pb] = await admin`insert into parishes (name, code) values ('Immo B', ${"IB" + sfx}) returning id`;
    const [pc] = await admin`insert into parishes (name, code) values ('Immo C', ${"IC" + sfx}) returning id`;
    const [pe] = await admin`insert into parishes (name, code) values ('Immo E', ${"IE" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id; ids.parishC = pc!.id; ids.parishE = pe!.id;
    for (const p of [ids.parishA!, ids.parishB!, ids.parishC!, ids.parishE!]) await seedAssetDefaults(adminDb, p);
    const mk = async (key: string, parish: string, ...roles: string[]) => {
      const [u] = await admin`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      for (const role of roles) await admin`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("admin", ids.parishA!, "administrateur");
    await mk("tresorier", ids.parishA!, "tresorier");
    await mk("pasteur", ids.parishA!, "pasteur");
    await mk("both", ids.parishA!, "tresorier", "pasteur"); // allowed by the role-conflict rules
    await mk("caissier", ids.parishA!, "caissier");
    await mk("auditeur", ids.parishA!, "auditeur");
    await mk("evang", ids.parishA!, "evangelisation");
    await mk("adminB", ids.parishB!, "administrateur");
    await mk("tresorierB", ids.parishB!, "tresorier");
    await mk("adminC", ids.parishC!, "administrateur");
    await mk("adminE", ids.parishE!, "administrateur");

    const loc = async (parish: string, name: string) => (await admin`select id from asset_locations where parish_id = ${parish} and name = ${name}`)[0]!.id as string;
    ids.locAdmin = await loc(ids.parishA!, "Administration");
    ids.locTemple = await loc(ids.parishA!, "Temple principal");
    ids.locEntrepot = await loc(ids.parishA!, "Entrepôt");
    ids.locB = await loc(ids.parishB!, "Administration");
    ids.locC = await loc(ids.parishC!, "Administration");
    ids.locE = await loc(ids.parishE!, "Administration");

    const [acct] = await admin`insert into accounts (parish_id, type, currency, name) values (${ids.parishA!}, 'caisse', 'CDF', 'Caisse Immo') returning id`;
    const cats = await admin`select id, name from categories`;
    const dep = cats.find((c: any) => c.name === "Loyer")!.id;
    const rec = cats.find((c: any) => c.name === "Offrande ordinaire")!.id;
    const tx = (n: number, kind: string, dir: string, cat: string) => admin`insert into transactions (parish_id, reference, kind, direction, account_id, category_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by)
      values (${ids.parishA!}, ${`IM-${sfx}-${n}`}, ${kind}, ${dir}, ${acct!.id}, ${cat}, 'CDF', 50000, '2800', 0, ${TODAY}, 'validee', ${ids.caissier!}) returning id`;
    ids.depTx = (await tx(1, "depense", "out", dep))[0]!.id;
    ids.recTx = (await tx(2, "recette", "in", rec))[0]!.id;
  });

  // ---- registering ---------------------------------------------------------------------------------------

  describe("registering a draft", () => {
    test("administrateur, trésorier and pasteur can register; caissier, auditeur and évangélisation cannot", async () => {
      for (const as of ["admin", "tresorier", "pasteur"]) expect((await call(as, "POST", "", draft())).status).toBe(201);
      for (const as of ["caissier", "auditeur", "evang"]) expect((await call(as, "POST", "", draft())).status).toBe(403);
    });

    test("reading follows transaction.readAll, not asset.manage", async () => {
      for (const as of ["admin", "tresorier", "pasteur", "auditeur"]) expect((await call(as, "GET", "")).status).toBe(200);
      for (const as of ["caissier", "evang"]) expect((await call(as, "GET", "")).status).toBe(403);
    });

    test("a draft gets its code, statut Brouillon, état Bon and a computed coût d'acquisition", async () => {
      const a = await mkDraft({ paMinor: "100000", faaMinor: "5000" });
      expect(a.code).toMatch(new RegExp(`^MI ${PERIOD} \\d{5}$`));
      expect([a.statut, a.etat, a.displayStatut]).toEqual(["brouillon", "bon", "brouillon"]);
      expect([a.paMinor, a.faaMinor, a.costMinor]).toEqual(["100000", "5000", "105000"]);
      expect(a.registeredAt).toBe(TODAY);
      expect(a.rate).toBe(20);
    });

    test("the coût d'acquisition cannot be typed", async () => {
      const r = await call("admin", "POST", "", draft({ costMinor: "999" }));
      expect(r.status).toBe(400);
      expect(typeof (await json(r)).error).toBe("string");
    });

    test("localisation is mandatory and must belong to the parish", async () => {
      const { locationId: _l, ...noLoc } = draft();
      expect((await call("admin", "POST", "", noLoc)).status).toBe(400);
      expect((await call("admin", "POST", "", draft({ locationId: ids.locB }))).status).toBe(422);
    });

    test("EUR needs no rate but may carry a frozen one; USD refuses a rate", async () => {
      const eur = await json(await call("admin", "POST", "", draft({ currency: "EUR", fxRatePerUsd: "0.9234" })));
      expect([eur.currency, eur.fxRatePerUsd, eur.fxRateDate]).toEqual(["EUR", "0.9234", TODAY]);
      expect((await call("admin", "POST", "", draft({ currency: "EUR" }))).status).toBe(201);
      expect((await call("admin", "POST", "", draft({ currency: "USD", fxRatePerUsd: "1" }))).status).toBe(400);
    });

    test("old assets can be entered (acquired in 1995)", async () => {
      expect((await call("admin", "POST", "", draft({ acquisitionDate: "1995-06-01", inServiceDate: "1995-06-01" }))).status).toBe(201);
    });

    test("an inactive or unknown acronym is refused", async () => {
      expect((await call("admin", "POST", "", draft({ acronym: "ZZ" }))).status).toBe(422);
    });

    test("transactionId must be a dépense of the same parish", async () => {
      expect((await call("admin", "POST", "", draft({ transactionId: ids.depTx }))).status).toBe(201);
      expect((await call("admin", "POST", "", draft({ transactionId: ids.recTx }))).status).toBe(422);
      expect((await call("admin", "POST", "", draft({ transactionId: crypto.randomUUID() }))).status).toBe(422);
    });

    test("non-amortissable has no duration; the other modes need one", async () => {
      expect((await call("admin", "POST", "", draft({ method: "non_amortissable", usefulLifeYears: null, inServiceDate: null, subaccountCode: "24.5" }))).status).toBe(201);
      expect((await call("admin", "POST", "", draft({ method: "non_amortissable", usefulLifeYears: 5 }))).status).toBe(400);
      expect((await call("admin", "POST", "", draft({ usefulLifeYears: null }))).status).toBe(400);
    });
  });

  // ---- codes ---------------------------------------------------------------------------------------------------

  describe("codes", () => {
    test("sequence restarts per acronym, is gap-free within it, and is independent per parish", async () => {
      const post = (acronym: string, parish: string, locationId: string, as = "adminC") =>
        send(app, as, "POST", "", draft({ acronym, locationId }), parish).then(json);
      const mi1 = await post("MI", ids.parishC!, ids.locC!);
      const mi2 = await post("MI", ids.parishC!, ids.locC!);
      const mb1 = await post("MB", ids.parishC!, ids.locC!);
      expect([mi1.code, mi2.code, mb1.code]).toEqual([`MI ${PERIOD} 00001`, `MI ${PERIOD} 00002`, `MB ${PERIOD} 00001`]);
      // parish B starts at 00001 too, whatever parish C has issued
      const miB = await post("MI", ids.parishB!, ids.locB!, "adminB");
      expect(miB.code).toBe(`MI ${PERIOD} 00001`);
    });

    test("20 concurrent registrations never produce a duplicate", async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () =>
        send(concurrentApp, "adminB", "POST", "", draft({ acronym: "MT", subaccountCode: "24.2", locationId: ids.locB }), ids.parishB).then(json)));
      const codes = results.map((r) => r.code);
      expect(codes.every((c) => typeof c === "string")).toBe(true);
      expect(new Set(codes).size).toBe(20);
      const seq = codes.map((c: string) => Number(c.split(" ")[2])).sort((a: number, b: number) => a - b);
      expect(seq).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    test("changing a draft's acronym issues a new code; the same acronym keeps it", async () => {
      const a = await mkDraft();
      const same = await json(await call("admin", "PATCH", `/${a.id}`, draft({ description: "Autre libellé" })));
      expect(same.code).toBe(a.code);
      const moved = await json(await call("admin", "PATCH", `/${a.id}`, draft({ acronym: "MB", subaccountCode: "24.4" })));
      expect(moved.code).toMatch(new RegExp(`^MB ${PERIOD} \\d{5}$`));
      expect(moved.code).not.toBe(a.code);
    });
  });

  // ---- drafts ----------------------------------------------------------------------------------------------------

  describe("draft lifecycle", () => {
    test("a never-submitted draft can be deleted", async () => {
      const a = await mkDraft();
      expect((await call("admin", "DELETE", `/${a.id}`)).status).toBe(204);
      expect((await call("admin", "GET", `/${a.id}`)).status).toBe(404);
    });

    test("an abandoned draft stays in the register as Annulé, with its audit trail", async () => {
      const a = await mkDraft();
      expect((await call("admin", "POST", `/${a.id}/discard`, {})).status).toBe(400); // motif required
      const r = await json(await call("admin", "POST", `/${a.id}/discard`, { reason: "Saisie en double" }));
      expect(r.statut).toBe("annule");
      expect((await call("admin", "GET", `/${a.id}`)).status).toBe(200);
      const trail = await json(await call("admin", "GET", `/${a.id}/audit`));
      expect(trail.map((e: any) => e.action)).toEqual(["asset.create", "asset.discard"]);
    });

    test("submitting needs the date de mise en service of a depreciable asset", async () => {
      const a = await mkDraft({ inServiceDate: null });
      const r = await call("admin", "POST", `/${a.id}/submit`);
      expect(r.status).toBe(422);
      expect((await json(r)).error).toContain("mise en service");
    });
  });

  // ---- creation circuit ---------------------------------------------------------------------------------------------------

  describe("creation approval (Trésorier then Pasteur)", () => {
    test("administrateur registers; Trésorier then Pasteur validate; the asset becomes Actif with an initial état Bon", async () => {
      const a = await mkDraft();
      const sub = await json(await call("admin", "POST", `/${a.id}/submit`, { comment: "Nouvel achat" }));
      expect(sub.request).toMatchObject({ kind: "creation", status: "en_attente_tresorier", n1Skipped: false, n2Skipped: false });
      expect(sub.asset.statut).toBe("en_attente_validation");

      // frozen while waiting
      expect((await call("admin", "PATCH", `/${a.id}`, draft())).status).toBe(422);
      expect((await call("admin", "DELETE", `/${a.id}`)).status).toBe(422);
      // the Pasteur cannot jump the queue, nor can the registrar approve
      expect((await approve2(sub.request.id)).status).toBe(422);
      expect((await approve1(sub.request.id, "admin")).status).toBe(403);
      // an open request blocks a second one
      expect((await call("admin", "POST", `/${a.id}/submit`)).status).toBe(422);

      const r1 = await json(await approve1(sub.request.id));
      expect([r1.status, r1.tresorierName]).toEqual(["approuvee_n1", "tresorier"]);
      expect((await approve1(sub.request.id)).status).toBe(422);
      const r2 = await json(await approve2(sub.request.id));
      expect([r2.status, r2.pasteurName]).toEqual(["executee", "pasteur"]);

      const active = await json(await call("admin", "GET", `/${a.id}`));
      expect([active.statut, active.etat, active.displayStatut]).toEqual(["actif", "bon", "en_amortissement"]);
      const hist = await json(await call("admin", "GET", `/${a.id}/etat-history`));
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ oldEtat: null, newEtat: "bon", reason: "Acquisition", validation: "approuve", locationName: "Administration" });

      const trail = await json(await call("admin", "GET", `/${a.id}/audit`));
      const activate = trail.find((e: any) => e.action === "asset.activate");
      expect(activate.after.tresorier.name).toBe("tresorier");
      expect(activate.after.pasteur.name).toBe("pasteur");
      expect(activate.after.tresorier.at).toBeTruthy();
      const detail = await json(await call("admin", "GET", `/requests/${sub.request.id}`));
      expect(detail.events.map((e: any) => e.toStatus)).toEqual(["en_attente_tresorier", "approuvee_n1", "approuvee_n2", "executee"]);
    });

    test("a rejected creation goes back to a draft that can be corrected and submitted again", async () => {
      const a = await mkDraft();
      const sub = await json(await call("admin", "POST", `/${a.id}/submit`));
      expect((await call("tresorier", "POST", `/requests/${sub.request.id}/reject`, {})).status).toBe(400); // motif required
      const rej = await json(await call("tresorier", "POST", `/requests/${sub.request.id}/reject`, { comment: "Facture manquante" }));
      expect([rej.status, rej.rejectedReason]).toEqual(["rejetee", "Facture manquante"]);
      const back = await json(await call("admin", "GET", `/${a.id}`));
      expect(back.statut).toBe("brouillon");
      // a draft that has been submitted once cannot be deleted any more (history is kept) but can be re-edited and re-submitted
      expect((await call("admin", "DELETE", `/${a.id}`)).status).toBe(422);
      expect((await call("admin", "PATCH", `/${a.id}`, draft({ invoiceNumber: "F-2026-01" }))).status).toBe(200);
      expect((await call("admin", "POST", `/${a.id}/submit`)).status).toBe(201);
    });

    test("a Trésorier who registers skips their own level: only the Pasteur signs", async () => {
      const a = await mkDraft({}, "tresorier");
      const sub = await json(await call("tresorier", "POST", `/${a.id}/submit`));
      expect(sub.request).toMatchObject({ status: "approuvee_n1", n1Skipped: true, n2Skipped: false });
      expect((await approve1(sub.request.id, "tresorier")).status).toBe(422);
      expect((await approve2(sub.request.id, "tresorier")).status).toBe(403);
      expect((await approve2(sub.request.id)).status).toBe(200);
      const active = await json(await call("admin", "GET", `/${a.id}`));
      expect(active.statut).toBe("actif");
      const trail = await json(await call("admin", "GET", `/${a.id}/audit`));
      const activate = trail.find((e: any) => e.action === "asset.activate");
      expect(activate.after.tresorier.nonRequis).toContain("Trésorier");
      expect(activate.after.pasteur.name).toBe("pasteur");
    });

    test("a Pasteur who registers skips their own level: the Trésorier's approval is final", async () => {
      const a = await mkDraft({}, "pasteur");
      const sub = await json(await call("pasteur", "POST", `/${a.id}/submit`));
      expect(sub.request).toMatchObject({ status: "en_attente_tresorier", n1Skipped: false, n2Skipped: true });
      expect((await approve2(sub.request.id, "pasteur")).status).toBe(422);
      const done = await json(await approve1(sub.request.id));
      expect(done.status).toBe("executee");
      expect((await json(await call("admin", "GET", `/${a.id}`))).statut).toBe("actif");
    });

    test("someone holding both approval roles cannot register and approve alone", async () => {
      const a = await mkDraft({}, "both");
      const r = await call("both", "POST", `/${a.id}/submit`);
      expect(r.status).toBe(422);
      expect((await json(r)).error).toContain("Trésorier et Pasteur");
      expect((await json(await call("both", "GET", `/${a.id}`))).statut).toBe("brouillon");
    });
  });

  // ---- immutability ----------------------------------------------------------------------------------------------------------

  describe("a validated asset is frozen in the database", () => {
    test("direct UPDATE or DELETE is refused, even for the table owner; drafts stay free", async () => {
      const act = await mkActive();
      await expect(sqlRows("update fixed_assets set description = 'x' where id = $1", [act.id])).rejects.toThrow(/Immobilisation validée/);
      await expect(sqlRows("update fixed_assets set pa_minor = 1 where id = $1", [act.id])).rejects.toThrow(/Immobilisation validée/);
      await expect(sqlRows("delete from fixed_assets where id = $1", [act.id])).rejects.toThrow(/suppression interdite/);
      await expect(sqlRows("update fixed_assets set etat = 'perdu' where id = $1", [act.id])).rejects.toThrow(/Immobilisation validée/);
      const dr = await mkDraft();
      expect(await sqlRows("update fixed_assets set description = 'ok' where id = $1 returning id", [dr.id])).toHaveLength(1);
      expect(await sqlRows("delete from fixed_assets where id = $1 returning id", [dr.id])).toHaveLength(1);
    });

    test("through the API a validated asset can be neither edited nor deleted", async () => {
      const act = await mkActive();
      const patch = await call("admin", "PATCH", `/${act.id}`, draft({ description: "Changé" }));
      expect(patch.status).toBe(422);
      expect((await json(patch)).error).toContain("demande de modification");
      expect((await call("admin", "DELETE", `/${act.id}`)).status).toBe(422);
      expect((await call("admin", "POST", `/${act.id}/discard`, { reason: "essai" })).status).toBe(422);
    });

    test("identity columns and the registration date can never change, not even while an approved request is being executed", async () => {
      const dr = await mkDraft();
      await expect(sqlRows("update fixed_assets set registered_at = '2001-01-01' where id = $1", [dr.id])).rejects.toThrow(/Identité/);
      await expect(sqlRows("update fixed_assets set parish_id = $2 where id = $1", [dr.id, ids.parishB])).rejects.toThrow(/Identité/);
      const act = await mkActive();
      // the execution flag lets a validated asset change, but never its identity
      await expect(admin.begin(async (x) => {
        await x`select set_config('app.asset_request_exec', 'on', true)`;
        await x`update fixed_assets set registered_at = '2001-01-01' where id = ${act.id}`;
      })).rejects.toThrow(/Identité/);
      await admin.begin(async (x) => {
        await x`select set_config('app.asset_request_exec', 'on', true)`;
        await x`update fixed_assets set description = 'changé par une demande exécutée' where id = ${act.id}`;
      });
      expect((await json(await call("admin", "GET", `/${act.id}`))).description).toBe("changé par une demande exécutée");
      // and the flag did not outlive its transaction
      await expect(sqlRows("update fixed_assets set description = 'sans demande' where id = $1", [act.id])).rejects.toThrow(/Immobilisation validée/);
    });

    test("an asset is created as a draft and only an approved request makes it active", async () => {
      const cols = "parish_id, code, registered_at, acronym, account_code, subaccount_code, description, acquisition_date, location_id, currency, pa_minor, depreciation_method, useful_life_years, created_by";
      const copy = (code: string, statut: string) => sqlRows(
        `insert into fixed_assets (${cols}, statut) select parish_id, '${code}', registered_at, acronym, account_code, subaccount_code, description, acquisition_date, location_id, currency, pa_minor, depreciation_method, useful_life_years, created_by, '${statut}' from fixed_assets where id = $1 returning id`,
        [ids.someAsset]);
      ids.someAsset = (await mkDraft()).id;
      await expect(copy(`ZZ ${PERIOD} 90001`, "actif")).rejects.toThrow(/créée en brouillon/);
      // a draft cannot be turned into an active asset by a plain UPDATE either
      const dr = await mkDraft();
      await expect(sqlRows("update fixed_assets set statut = 'actif' where id = $1", [dr.id])).rejects.toThrow(/Immobilisation validée/);
      // only the execution of a request may
      await admin.begin(async (x) => {
        await x`select set_config('app.asset_request_exec', 'on', true)`;
        await x`update fixed_assets set statut = 'actif' where id = ${dr.id}`;
      });
      expect((await json(await call("admin", "GET", `/${dr.id}`))).statut).toBe("actif");
    });

    test("the état history, request events and requests are append-only", async () => {
      const act = await mkActive();
      await expect(sqlRows("update asset_condition_history set reason = 'x' where asset_id = $1", [act.id])).rejects.toThrow(/en ajout seul/);
      await expect(sqlRows("delete from asset_condition_history where asset_id = $1", [act.id])).rejects.toThrow(/en ajout seul/);
      await expect(sqlRows("delete from asset_requests where asset_id = $1", [act.id])).rejects.toThrow(/en ajout seul/);
      await expect(sqlRows("update asset_request_events set comment = 'x' where request_id in (select id from asset_requests where asset_id = $1)", [act.id])).rejects.toThrow(/en ajout seul/);
    });

    test("only one open request per asset, enforced by the database", async () => {
      const act = await mkActive();
      const r = await json(await request("admin", act.id, { kind: "annulation", reason: "Saisie en double" }));
      expect(r.status).toBe("en_attente_tresorier");
      await expect(sqlRows(
        `insert into asset_requests (parish_id, reference, asset_id, kind, reason, requester_id) values ($1, $2, $3, 'annulation', 'x', $4)`,
        [ids.parishA, `DUP-${sfx}-${Math.random()}`, act.id, ids.admin],
      )).rejects.toThrow(/ar_one_open|duplicate/);
    });
  });

  // ---- modification & annulation -------------------------------------------------------------------------------------------------

  describe("modification and annulation requests", () => {
    test("a modification records old and new values and only applies after both approvals", async () => {
      const act = await mkActive();
      const req = await json(await request("admin", act.id, { kind: "modification", reason: "Déménagement", changes: { locationId: ids.locTemple, paMinor: "120000" } }));
      expect(req).toMatchObject({ kind: "modification", status: "en_attente_tresorier", requesterName: "admin" });
      expect(req.proposedChanges).toEqual({ locationId: ids.locTemple, paMinor: "120000" });
      expect(req.oldValues).toEqual({ locationId: ids.locAdmin, paMinor: "100000" });

      // nothing changes yet
      expect((await json(await call("admin", "GET", `/${act.id}`))).locationId).toBe(ids.locAdmin);
      // one open request at a time
      expect((await request("admin", act.id, { kind: "annulation", reason: "Autre demande" })).status).toBe(422);

      await approve1(req.id);
      expect((await json(await call("admin", "GET", `/${act.id}`))).locationId).toBe(ids.locAdmin);
      await approve2(req.id);
      const after = await json(await call("admin", "GET", `/${act.id}`));
      expect([after.locationId, after.locationName, after.paMinor, after.costMinor]).toEqual([ids.locTemple, "Temple principal", "120000", "125000"]);

      const trail = await json(await call("admin", "GET", `/${act.id}/audit`));
      const mod = trail.find((e: any) => e.action === "asset.modify");
      expect(mod.before).toEqual({ locationId: ids.locAdmin, paMinor: "100000" });
      expect(mod.after).toMatchObject({ locationId: ids.locTemple, paMinor: "120000", reason: "Déménagement" });
      expect([mod.after.tresorier.name, mod.after.pasteur.name]).toEqual(["tresorier", "pasteur"]);
    });

    test("a refused modification leaves the asset untouched", async () => {
      const act = await mkActive();
      const req = await json(await request("admin", act.id, { kind: "modification", reason: "Test de validation", changes: { description: "Nouveau nom" } }));
      await call("tresorier", "POST", `/requests/${req.id}/reject`, { comment: "Pas justifié" });
      const a = await json(await call("admin", "GET", `/${act.id}`));
      expect(a.description).toBe(act.description);
      expect(a.openRequest).toBeNull();
      // and a new request can be made afterwards
      expect((await request("admin", act.id, { kind: "annulation", reason: "Saisie en double" })).status).toBe(201);
    });

    test("modifications are validated: no change, wrong values, unknown fields, other parish's referentials", async () => {
      const act = await mkActive();
      expect((await request("admin", act.id, { kind: "modification", reason: "Sans changement", changes: { description: act.description } })).status).toBe(422);
      expect((await request("admin", act.id, { kind: "modification", reason: "Sans changement" })).status).toBe(400);
      expect((await request("admin", act.id, { kind: "modification", reason: "Test de validation", changes: { etat: "perdu" } })).status).toBe(400);
      expect((await request("admin", act.id, { kind: "modification", reason: "Test de validation", changes: { locationId: ids.locB } })).status).toBe(422);
      expect((await request("admin", act.id, { kind: "modification", reason: "Test de validation", changes: { subaccountCode: "23.2" } })).status).toBe(422); // sous-compte ≠ compte 24
      expect((await request("admin", act.id, { kind: "modification", reason: "Test de validation", changes: { method: "non_amortissable" } })).status).toBe(422); // still has a duration
      expect((await request("admin", act.id, { kind: "annulation", reason: "Test de validation", changes: { description: "x" } })).status).toBe(400);
      expect((await request("admin", act.id, { kind: "annulation", reason: "abcd" })).status).toBe(400); // motif too short
      expect((await request("caissier", act.id, { kind: "annulation", reason: "Saisie en double" })).status).toBe(403);
    });

    test("changing the depreciation parameters re-derives the dégressif coefficient", async () => {
      const act = await mkActive();
      expect(act.degressiveCoefficient).toBeNull();
      const req = await json(await request("admin", act.id, { kind: "modification", reason: "Passage en dégressif", changes: { method: "degressif" } }));
      await approve1(req.id);
      await approve2(req.id);
      const a = await json(await call("admin", "GET", `/${act.id}`));
      expect([a.depreciationMethod, a.degressiveCoefficient, a.rate]).toEqual(["degressif", "2", 40]);
    });

    test("an exceptional code change is justified, unique, audited separately", async () => {
      const act = await mkActive();
      const other = await mkDraft();
      expect((await request("admin", act.id, { kind: "modification", reason: "Code erroné", changes: { code: other.code } })).status).toBe(422); // taken
      expect((await request("admin", act.id, { kind: "modification", reason: "Code erroné", changes: { code: "XX 202601 00001" } })).status).toBe(422); // no such acronym
      const newCode = `MI ${PERIOD} 9${Math.floor(Math.random() * 9000 + 1000)}`;
      const req = await json(await request("admin", act.id, { kind: "modification", reason: "Code erroné", changes: { code: newCode } }));
      await approve1(req.id);
      await approve2(req.id);
      expect((await json(await call("admin", "GET", `/${act.id}`))).code).toBe(newCode);
      const trail = await json(await call("admin", "GET", `/${act.id}/audit`));
      const change = trail.find((e: any) => e.action === "asset.code_change");
      expect(change.before.code).toBe(act.code);
      expect(change.after).toMatchObject({ code: newCode, exceptionnel: true, reason: "Code erroné" });
    });

    test("an annulation keeps the record: statut Annulé, still readable, still in the register", async () => {
      const act = await mkActive();
      const req = await json(await request("admin", act.id, { kind: "annulation", reason: "Bien jamais reçu" }));
      await approve1(req.id);
      await approve2(req.id);
      const a = await json(await call("admin", "GET", `/${act.id}`));
      expect(a.statut).toBe("annule");
      const list = await json(await call("admin", "GET", `?statut=annule&q=${encodeURIComponent(act.code)}`));
      expect(list.rows.map((r: any) => r.id)).toContain(act.id);
      expect((await json(await call("admin", "GET", `/${act.id}/audit`))).map((e: any) => e.action)).toContain("asset.cancel");
      // and nothing more can be requested on it
      expect((await request("admin", act.id, { kind: "annulation", reason: "Encore" })).status).toBe(422);
    });

    test("the request list can be filtered and a request shows its asset", async () => {
      const act = await mkActive();
      const req = await json(await request("admin", act.id, { kind: "annulation", reason: "Saisie en double" }));
      const list = await json(await call("tresorier", "GET", `/requests?status=en_attente_tresorier&assetId=${act.id}`));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: req.id, assetCode: act.code, requesterName: "admin" });
      expect(await json(await call("tresorier", "GET", `/requests?assetId=${act.id}&kind=modification`))).toHaveLength(0);
      expect((await call("caissier", "GET", "/requests")).status).toBe(403);
    });
  });

  // ---- état ----------------------------------------------------------------------------------------------------------------------

  describe("état and its history", () => {
    test("Bon ↔ Mauvais is immediate, needs a motif, and Mauvais needs a justification", async () => {
      const act = await mkActive();
      const post = (b: unknown) => call("admin", "POST", `/${act.id}/etat`, b);
      expect((await post({ newEtat: "mauvais", reason: "Panne" })).status).toBe(400); // justification missing
      expect((await post({ newEtat: "mauvais", reason: "", observation: "Écran cassé" })).status).toBe(400); // motif missing
      expect((await post({ newEtat: "bon", reason: "Pas de changement" })).status).toBe(422); // already Bon
      const ok = await json(await post({ newEtat: "mauvais", reason: "Panne", observation: "Écran cassé" }));
      expect(ok).toMatchObject({ pending: false, etat: "mauvais" });
      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("mauvais");
      expect((await post({ newEtat: "bon", reason: "Réparation" })).status).toBe(200); // no justification needed for Bon
      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("bon");

      const hist = await json(await call("admin", "GET", `/${act.id}/etat-history`));
      expect(hist.map((h: any) => [h.oldEtat, h.newEtat, h.reason, h.validation])).toEqual([
        [null, "bon", "Acquisition", "approuve"], ["bon", "mauvais", "Panne", "non_requis"], ["mauvais", "bon", "Réparation", "non_requis"],
      ]);
      expect(hist[1]).toMatchObject({ observation: "Écran cassé", locationName: "Administration", actorName: "admin" });
      expect(hist[1].at).toBeTruthy();
    });

    test("the état shown is always the latest recorded one", async () => {
      const act = await mkActive();
      for (const [newEtat, observation] of [["mauvais", "Rayé"], ["bon", undefined], ["mauvais", "Cassé"]] as const)
        await call("admin", "POST", `/${act.id}/etat`, { newEtat, reason: "Contrôle", observation });
      const [row] = await sqlRows(
        "select a.etat, (select new_etat from asset_condition_history h where h.asset_id = a.id order by at desc, id desc limit 1) as last from fixed_assets a where a.id = $1", [act.id]);
      expect(row.etat).toBe("mauvais");
      expect(row.last).toBe(row.etat);
    });

    test("Déclassé and Perdu are sensitive: they only take effect after Trésorier and Pasteur approve", async () => {
      const act = await mkActive();
      const r = await call("admin", "POST", `/${act.id}/etat`, { newEtat: "perdu", reason: "Inventaire", observation: "Introuvable depuis mars" });
      expect(r.status).toBe(202);
      const { pending, request: req } = await json(r);
      expect([pending, req.kind, req.status]).toEqual([true, "changement_etat", "en_attente_tresorier"]);

      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("bon"); // unchanged
      const waiting = await json(await call("admin", "GET", `/${act.id}/etat-history`));
      expect(waiting.at(-1)).toMatchObject({ newEtat: "perdu", validation: "en_attente", requestReference: req.reference });
      // no other change while waiting
      expect((await call("admin", "POST", `/${act.id}/etat`, { newEtat: "mauvais", reason: "Contrôle", observation: "Constat" })).status).toBe(422);

      await approve1(req.id);
      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("bon"); // still the Pasteur to go
      await approve2(req.id);
      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("perdu");
      const hist = await json(await call("admin", "GET", `/${act.id}/etat-history`));
      expect(hist.at(-1)).toMatchObject({ oldEtat: "bon", newEtat: "perdu", validation: "approuve", observation: "Introuvable depuis mars", requestReference: req.reference });
      expect(hist).toHaveLength(2); // the executed request is not listed twice

      // leaving Perdu is sensitive too
      const back = await call("admin", "POST", `/${act.id}/etat`, { newEtat: "bon", reason: "Retrouvé" });
      expect(back.status).toBe(202);
    });

    test("a refused sensitive change leaves the état and is shown as refused", async () => {
      const act = await mkActive();
      const { request: req } = await json(await call("admin", "POST", `/${act.id}/etat`, { newEtat: "declasse", reason: "Obsolescence", observation: "Plus utilisable" }));
      await call("tresorier", "POST", `/requests/${req.id}/reject`, { comment: "Encore utilisable" });
      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("bon");
      const hist = await json(await call("admin", "GET", `/${act.id}/etat-history`));
      expect(hist.at(-1)).toMatchObject({ newEtat: "declasse", validation: "refuse", rejectedReason: "Encore utilisable" });
    });

    test("a Trésorier who asks for a sensitive change skips only their own level", async () => {
      const act = await mkActive();
      const { request: req } = await json(await call("tresorier", "POST", `/${act.id}/etat`, { newEtat: "perdu", reason: "Vol", observation: "Plainte déposée" }));
      expect(req).toMatchObject({ status: "approuvee_n1", n1Skipped: true });
      await approve2(req.id);
      expect((await json(await call("admin", "GET", `/${act.id}`))).etat).toBe("perdu");
    });

    test("no état change on a draft or a cancelled asset", async () => {
      const dr = await mkDraft();
      expect((await call("admin", "POST", `/${dr.id}/etat`, { newEtat: "mauvais", reason: "Contrôle", observation: "Constat" })).status).toBe(422);
      const gone = await mkDraft();
      await call("admin", "POST", `/${gone.id}/discard`, { reason: "Saisie en double" });
      expect((await json(await call("admin", "GET", `/${gone.id}`))).statut).toBe("annule");
      expect((await call("admin", "POST", `/${gone.id}/etat`, { newEtat: "mauvais", reason: "Contrôle", observation: "Constat" })).status).toBe(422);
    });

    test("a sensitive état only enters the history as the outcome of a request", async () => {
      const act = await mkActive();
      await expect(sqlRows(
        "insert into asset_condition_history (parish_id, asset_id, old_etat, new_etat, reason, observation, location_id, actor_id) values ($1, $2, 'bon', 'perdu', 'x', 'y', $3, $4)",
        [ids.parishA, act.id, act.locationId, ids.admin])).rejects.toThrow(/ach_sensitive_needs_request/);
    });
  });

  // ---- depreciation figures ------------------------------------------------------------------------------------------------------------

  describe("depreciation figures", () => {
    test("linéaire with prorata from the mise en service, as of a given month", async () => {
      const a = await mkDraft({ paMinor: "60000", faaMinor: "0", inServiceDate: "2026-07-01", acquisitionDate: "2026-07-01" });
      const at = async (asOf: string) => json(await call("admin", "GET", `/${a.id}?asOf=${asOf}`));
      const sep = await at("2026-09-30");
      expect([sep.accumulatedMinor, sep.exerciseMinor, sep.vncMinor, sep.depreciableMinor, sep.rate]).toEqual(["3000", "3000", "57000", "60000", 20]);
      const end = await at("2031-12-31");
      expect([end.vncMinor, end.depreciationState]).toEqual(["0", "entierement_amorti"]);
      const before = await at("2026-06-30");
      expect([before.accumulatedMinor, before.vncMinor, before.depreciationState]).toEqual(["0", "60000", "non_demarre"]);
      expect(sep.schedule.map((r: any) => r.annuityMinor)).toEqual(["6000", "12000", "12000", "12000", "12000", "6000"]);
    });

    test("dégressif uses the coefficient of the parish settings, frozen on the asset", async () => {
      const a = await json(await call("admin", "POST", "", draft({ method: "degressif", usefulLifeYears: 5, paMinor: "100000", faaMinor: "0", acquisitionDate: "2026-01-10", inServiceDate: "2026-01-10" })));
      expect([a.degressiveCoefficient, a.rate]).toEqual(["2", 40]);
      const year1 = await json(await call("admin", "GET", `/${a.id}?asOf=2026-12-31`));
      expect([year1.exerciseMinor, year1.vncMinor]).toEqual(["40000", "60000"]);
      // The parish edits its table: 5-6 years now means 3. Existing assets keep their frozen coefficient.
      const put = await app.request("/api/settings", {
        method: "PUT", headers: { authorization: `Bearer admin-${sfx}`, "content-type": "application/json", "x-parish-id": ids.parishA! },
        body: JSON.stringify({ asset_degressive_coefficients: [{ min: 3, max: 4, coef: 1.5 }, { min: 5, max: 6, coef: 3 }, { min: 7, max: null, coef: 2.5 }] }),
      }, env);
      expect(put.status).toBe(200);
      const b = await json(await call("admin", "POST", "", draft({ method: "degressif", usefulLifeYears: 5 })));
      expect(b.degressiveCoefficient).toBe("3");
      expect((await json(await call("admin", "GET", `/${a.id}`))).degressiveCoefficient).toBe("2");
      await app.request("/api/settings", {
        method: "PUT", headers: { authorization: `Bearer admin-${sfx}`, "content-type": "application/json", "x-parish-id": ids.parishA! },
        body: JSON.stringify({ asset_degressive_coefficients: [{ min: 3, max: 4, coef: 1.5 }, { min: 5, max: 6, coef: 2 }, { min: 7, max: null, coef: 2.5 }] }),
      }, env);
    });

    test("non amortissable: no rate, no depreciation, VNC = coût", async () => {
      const a = await json(await call("admin", "POST", "", draft({ method: "non_amortissable", usefulLifeYears: null, inServiceDate: null, accountCode: "22", subaccountCode: "22.1", acronym: "TE" })));
      expect([a.rate, a.exerciseMinor, a.accumulatedMinor, a.vncMinor, a.depreciableMinor, a.depreciationState]).toEqual([null, "0", "0", "105000", "0", "non_amortissable"]);
      expect(a.schedule).toEqual([]);
    });
  });

  // ---- search, filters, pagination -----------------------------------------------------------------------------------------------------------

  describe("register search and filters", () => {
    // Parish E is private to this block, so counts are exact.
    const post = (o: Record<string, unknown>) => send(app, "adminE", "POST", "", draft({ locationId: ids.locE, ...o }), ids.parishE!).then(json);
    const list = async (qs: string) => json(await send(app, "adminE", "GET", qs ? `?${qs}` : "", undefined, ids.parishE!));
    const codes = (r: any) => r.rows.map((x: any) => x.description).sort();
    let supplierId = "";
    let locationId2 = "";

    beforeAll(async () => {
      supplierId = (await json(await send(app, "adminE", "POST", "/refs/suppliers", { name: "Bureau Plus" }, ids.parishE!))).id;
      locationId2 = (await admin`select id from asset_locations where parish_id = ${ids.parishE!} and name = 'Entrepôt'`)[0]!.id;
      await post({ description: "Laptop Alpha", invoiceNumber: "FAC-2026-001", supplierId, acquisitionDate: "2026-03-10", inServiceDate: "2026-03-10", paMinor: "300000", faaMinor: "0" });
      await post({ description: "Camionnette Beta", acronym: "MT", subaccountCode: "24.2", currency: "CDF", locationId: locationId2, acquisitionDate: "2025-11-20", inServiceDate: "2025-11-20", paMinor: "900000", faaMinor: "0", usefulLifeYears: 8 });
      await post({ description: "Orgue Gamma", acronym: "MO", subaccountCode: "24.4", acquisitionDate: "2025-01-05", inServiceDate: "2025-01-05", paMinor: "50000", faaMinor: "0", method: "degressif" });
      await post({ description: "Parcelle Delta", acronym: "TE", accountCode: "22", subaccountCode: "22.1", method: "non_amortissable", usefulLifeYears: null, inServiceDate: null, acquisitionDate: "2024-06-01", paMinor: "7000000", faaMinor: "0" });
    });

    test("search: code, description, invoice number, supplier, location, account label, year, currency", async () => {
      expect(codes(await list("q=Laptop"))).toEqual(["Laptop Alpha"]);
      expect(codes(await list("q=fac-2026"))).toEqual(["Laptop Alpha"]);
      expect(codes(await list("q=bureau%20plus"))).toEqual(["Laptop Alpha"]);
      expect(codes(await list("q=entrepot"))).toEqual([]); // location search keeps accents: "Entrepôt"
      expect(codes(await list("q=Entrep%C3%B4t"))).toEqual(["Camionnette Beta"]);
      expect(codes(await list("q=informatique"))).toEqual(["Laptop Alpha"]); // sous-compte 24.5 Matériel informatique
      expect(codes(await list("q=24.2"))).toEqual(["Camionnette Beta"]);
      expect(codes(await list("q=2025"))).toEqual(["Camionnette Beta", "Orgue Gamma"]);
      expect(codes(await list("q=CDF"))).toEqual(["Camionnette Beta"]);
      const first = (await list("q=Alpha")).rows[0];
      expect(codes(await list(`q=${encodeURIComponent(first.code)}`))).toEqual(["Laptop Alpha"]);
      expect((await list("q=%25")).rows).toHaveLength(0); // "%" is literal, not a wildcard
    });

    test("filters: compte, sous-compte, année, localisation, fournisseur, devise, mode, état, statut", async () => {
      expect(codes(await list("account=22"))).toEqual(["Parcelle Delta"]);
      expect(codes(await list("subaccount=24.4"))).toEqual(["Orgue Gamma"]);
      expect(codes(await list("year=2025"))).toEqual(["Camionnette Beta", "Orgue Gamma"]);
      expect(codes(await list(`locationId=${locationId2}`))).toEqual(["Camionnette Beta"]);
      expect(codes(await list(`supplierId=${supplierId}`))).toEqual(["Laptop Alpha"]);
      expect(codes(await list("currency=CDF"))).toEqual(["Camionnette Beta"]);
      expect(codes(await list("mode=degressif"))).toEqual(["Orgue Gamma"]);
      expect(codes(await list("mode=non_amortissable"))).toEqual(["Parcelle Delta"]);
      expect((await list("etat=bon")).rows).toHaveLength(4);
      expect((await list("etat=perdu")).rows).toHaveLength(0);
      expect((await list("statut=brouillon")).rows).toHaveLength(4);
      expect(codes(await list("from=2025-06-01&to=2026-12-31"))).toEqual(["Camionnette Beta", "Laptop Alpha"]);
      expect(codes(await list("account=24&currency=USD&q=a"))).toEqual(["Laptop Alpha", "Orgue Gamma"]);
      expect((await list("account=&q=")).rows).toHaveLength(4); // cleared filters are ignored
      expect((await send(app, "adminE", "GET", "?account=99", undefined, ids.parishE!)).status).toBe(400);
    });

    test("pagination and sorting; the register carries every column the spec lists", async () => {
      const p1 = await list("pageSize=3&page=1&sort=cost_minor&dir=asc");
      const p2 = await list("pageSize=3&page=2&sort=cost_minor&dir=asc");
      expect([p1.total, p1.rows.length, p2.rows.length, p1.pageSize]).toEqual([4, 3, 1, 3]);
      expect(p1.rows.map((r: any) => r.description)).toEqual(["Orgue Gamma", "Laptop Alpha", "Camionnette Beta"]);
      expect(p2.rows[0].description).toBe("Parcelle Delta");
      expect((await send(app, "adminE", "GET", "?pageSize=500", undefined, ids.parishE!)).status).toBe(400);
      const row = p1.rows[0];
      for (const k of ["code", "accountCode", "subaccountCode", "description", "invoiceNumber", "supplierName", "locationName", "acquisitionDate", "inServiceDate",
        "currency", "paMinor", "faaMinor", "costMinor", "depreciationMethod", "usefulLifeYears", "rate", "exerciseMinor", "accumulatedMinor", "vncMinor", "etat", "statut", "displayStatut"])
        expect(k in row).toBe(true);
    });

    test("a draft with a pending request shows it in the list", async () => {
      const act = await mkActive();
      await request("admin", act.id, { kind: "annulation", reason: "Saisie en double" });
      const r = await json(await call("admin", "GET", `?q=${encodeURIComponent(act.code)}`));
      expect(r.rows[0].openRequest).toMatchObject({ kind: "annulation", status: "en_attente_tresorier" });
    });
  });

  // ---- referentials ---------------------------------------------------------------------------------------------------------------------------------

  describe("referentials", () => {
    test("GET /refs gives the seeded acronyms, locations and settings; consolidated reads work too", async () => {
      const r = await json(await call("tresorier", "GET", "/refs"));
      expect(r.prefixes.map((p: any) => p.acronym)).toEqual(expect.arrayContaining(["MB", "MT", "MI", "MO"]));
      expect(r.locations.map((l: any) => l.name)).toEqual(expect.arrayContaining(["Temple principal", "Bureau pastoral", "Administration", "Presbytère", "École", "Salle de réunion", "Département", "Entrepôt", "Autre site"]));
      expect(r.degressiveCoefficients).toHaveLength(3);
      expect(r.labelFormat).toMatchObject({ mode: "roll", showQr: true });
      expect("cdfPerUsd" in r).toBe(true);
    });

    test("acronyms: config.manage only, unique, immutable, deactivated rather than deleted", async () => {
      expect((await call("tresorier", "POST", "/refs/prefixes", { acronym: "XY", label: "Divers" })).status).toBe(403);
      const made = await call("admin", "POST", "/refs/prefixes", { acronym: "XY", label: "Divers", subaccountCodes: ["24.1"] });
      expect(made.status).toBe(201);
      const p = await json(made);
      expect((await call("admin", "POST", "/refs/prefixes", { acronym: "XY", label: "Autre" })).status).toBe(422);
      expect((await call("admin", "POST", "/refs/prefixes", { acronym: "xy1", label: "Mauvais" })).status).toBe(400);
      expect((await call("admin", "PATCH", `/refs/prefixes/${p.id}`, { acronym: "ZZ" })).status).toBe(400); // immutable
      expect((await call("admin", "POST", "", draft({ acronym: "XY", subaccountCode: "24.1" }))).status).toBe(201);
      await call("admin", "PATCH", `/refs/prefixes/${p.id}`, { active: false });
      expect((await call("admin", "POST", "", draft({ acronym: "XY" }))).status).toBe(422);
      expect((await json(await call("admin", "GET", "/refs"))).prefixes.map((x: any) => x.acronym)).not.toContain("XY");
      expect((await json(await call("admin", "GET", "/refs?all=1"))).prefixes.map((x: any) => x.acronym)).toContain("XY");
    });

    test("locations and suppliers are unique per parish ignoring case; a supplier can be added by a registrar", async () => {
      expect((await call("tresorier", "POST", "/refs/locations", { name: "Cave" })).status).toBe(403);
      expect((await call("admin", "POST", "/refs/locations", { name: "Cave" })).status).toBe(201);
      expect((await call("admin", "POST", "/refs/locations", { name: "CAVE" })).status).toBe(422);
      const s = await call("tresorier", "POST", "/refs/suppliers", { name: `Fournisseur ${sfx}`, phone: "+243 81 000 0000" });
      expect(s.status).toBe(201);
      expect((await call("pasteur", "POST", "/refs/suppliers", { name: `fournisseur ${sfx}` })).status).toBe(422);
      expect((await call("auditeur", "POST", "/refs/suppliers", { name: "Refusé" })).status).toBe(403);
      const sup = await json(s);
      expect((await call("admin", "POST", "", draft({ supplierId: sup.id }))).status).toBe(201);
      await call("tresorier", "PATCH", `/refs/suppliers/${sup.id}`, { active: false });
      expect((await call("admin", "POST", "", draft({ supplierId: sup.id }))).status).toBe(422);
    });

    test("a new parish gets its default acronyms and locations", async () => {
      const [p] = await admin`insert into parishes (name, code) values ('Immo D', ${"ID" + sfx}) returning id`;
      await seedAssetDefaults(createDb(ADMIN_URL!), p!.id);
      await seedAssetDefaults(createDb(ADMIN_URL!), p!.id); // idempotent
      const n = (await admin`select count(*)::int as n from asset_locations where parish_id = ${p!.id}`)[0]!.n;
      const m = (await admin`select count(*)::int as m from asset_code_prefixes where parish_id = ${p!.id}`)[0]!.m;
      expect([n, m]).toEqual([9, 10]);
    });
  });


  // ---- attachments and print trail ----------------------------------------------------------------------------------------

  describe("pièces jointes", () => {
    const pdf = () => new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])], "facture.pdf", { type: "application/pdf" });

    test("a registrar attaches a scan; readers can list and open it; the trail records it", async () => {
      const act = await mkActive();
      const up = await upload("admin", act.id, pdf());
      expect(up.status).toBe(201);
      const f = await json(up);
      expect(f.filename).toBe("facture.pdf");
      expect(bucket.size).toBeGreaterThan(0);

      const list = await json(await call("auditeur", "GET", `/${act.id}/files`));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: f.id, filename: "facture.pdf", uploadedByName: "admin" });
      const dl = await call("auditeur", "GET", `/files/${f.id}?download=1`);
      expect(dl.status).toBe(200);
      expect(dl.headers.get("content-type")).toBe("application/pdf");
      expect(dl.headers.get("content-disposition")).toContain("attachment");
      expect(new Uint8Array(await dl.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]));
      const trail = await json(await call("admin", "GET", `/${act.id}/audit`));
      expect(trail.map((e: any) => e.action)).toContain("asset.file.add");
    });

    test("only registrars upload or delete; type and size are enforced; other parishes cannot read", async () => {
      const act = await mkActive();
      expect((await upload("auditeur", act.id, pdf())).status).toBe(403);
      expect((await upload("caissier", act.id, pdf())).status).toBe(403);
      expect((await upload("admin", act.id, new File(["x"], "note.txt", { type: "text/plain" }))).status).toBe(415);
      expect((await upload("admin", act.id, new File([new Uint8Array(8 * 1024 * 1024 + 1)], "gros.pdf", { type: "application/pdf" }))).status).toBe(413);
      const f = await json(await upload("tresorier", act.id, pdf()));
      expect((await call("tresorierB", "GET", `/files/${f.id}`, undefined, ids.parishB)).status).toBe(404);
      expect((await call("tresorierB", "GET", `/${act.id}/files`, undefined, ids.parishB)).status).toBe(404);
      expect((await call("auditeur", "DELETE", `/files/${f.id}`)).status).toBe(403);
    });

    test("deleting a file removes the stored object and is audited", async () => {
      const act = await mkActive();
      const f = await json(await upload("admin", act.id, pdf()));
      const before = bucket.size;
      expect((await call("admin", "DELETE", `/files/${f.id}`)).status).toBe(204);
      expect(bucket.size).toBe(before - 1);
      expect(await json(await call("admin", "GET", `/${act.id}/files`))).toHaveLength(0);
      expect((await json(await call("admin", "GET", `/${act.id}/audit`))).map((e: any) => e.action)).toEqual(expect.arrayContaining(["asset.file.add", "asset.file.delete"]));
    });

    test("nothing can be attached to a cancelled asset", async () => {
      const dr = await mkDraft();
      await call("admin", "POST", `/${dr.id}/discard`, { reason: "Saisie en double" });
      expect((await upload("admin", dr.id, pdf())).status).toBe(422);
    });
  });

  describe("impression et export tracés", () => {
    const log = (as: string, kind: string, idList: string[], parish = ids.parishA) => call(as, "POST", "/print-log", { kind, ids: idList }, parish);

    test("a reprint is recorded as such, per kind", async () => {
      const act = await mkActive();
      expect(await json(await log("admin", "etiquette", [act.id]))).toEqual({ logged: 1, reprints: 0 });
      expect(await json(await log("tresorier", "etiquette", [act.id]))).toEqual({ logged: 1, reprints: 1 });
      expect(await json(await log("admin", "code", [act.id]))).toEqual({ logged: 1, reprints: 0 }); // the code was never printed before
      const trail = await json(await call("admin", "GET", `/${act.id}/audit`));
      const prints = trail.filter((e: any) => e.action.startsWith("asset.print") || e.action === "asset.reprint");
      expect(prints.map((e: any) => [e.action, e.after.kind, e.actorName])).toEqual([
        ["asset.print", "etiquette", "admin"], ["asset.reprint", "etiquette", "tresorier"], ["asset.print", "code", "admin"],
      ]);
    });

    test("only validated assets are printed; the batch is checked as a whole", async () => {
      const act = await mkActive();
      const dr = await mkDraft();
      const r = await log("admin", "etiquette", [act.id, dr.id]);
      expect(r.status).toBe(422);
      expect((await json(r)).error).toContain(dr.code);
      // nothing was logged for the valid one either
      const trail = await json(await call("admin", "GET", `/${act.id}/audit`));
      expect(trail.some((e: any) => e.action === "asset.print")).toBe(false);
      // a fiche export may be logged for any asset
      expect((await log("admin", "export", [dr.id])).status).toBe(200);
    });

    test("input is validated and scoped to the parish; readers may print, caissier may not", async () => {
      const act = await mkActive();
      expect((await log("admin", "etiquette", [])).status).toBe(400);
      expect((await log("admin", "poster", [act.id])).status).toBe(400);
      expect((await log("admin", "etiquette", [crypto.randomUUID()])).status).toBe(404);
      expect((await log("adminB", "etiquette", [act.id], ids.parishB)).status).toBe(404);
      expect((await log("auditeur", "etiquette", [act.id])).status).toBe(200);
      expect((await log("caissier", "etiquette", [act.id])).status).toBe(403);
      expect((await log("admin", "etiquette", Array.from({ length: 501 }, () => crypto.randomUUID()))).status).toBe(400);
    });
  });


  // ---- reports ---------------------------------------------------------------------------------------------------------------

  describe("rapports", () => {
    const data = async (qs: string, as = "tresorier", parish = ids.parishA) => json(await call(as, "GET", `/reports/data?${qs}`, undefined, parish));
    const toSource = (r: any): AssetReportSource => ({ ...r, years: r.years, coefficient: r.coefficient, paMinor: BigInt(r.paMinor), faaMinor: BigInt(r.faaMinor), costMinor: BigInt(r.costMinor) });

    test("only validated assets are part of the patrimoine", async () => {
      const marker = `Rapport-${sfx}-${Math.random().toString(36).slice(2, 6)}`;
      const act = await mkActive({ description: `${marker} actif` });
      await mkDraft({ description: `${marker} brouillon` });
      const pending = await mkDraft({ description: `${marker} attente` });
      await call("admin", "POST", `/${pending.id}/submit`);
      const cancelled = await mkActive({ description: `${marker} annulé` });
      const req = await json(await request("admin", cancelled.id, { kind: "annulation", reason: "Saisie en double" }));
      await approve1(req.id); await approve2(req.id);

      const r = await data(`q=${encodeURIComponent(marker)}`);
      expect(r.rows.map((x: any) => x.id)).toEqual([act.id]);
      expect(r.rows[0]).toMatchObject({ code: act.code, accountCode: "24", subaccountCode: "24.5", locationName: "Administration", currency: "USD", paMinor: "100000", faaMinor: "5000", costMinor: "105000", etat: "bon", method: "lineaire", years: 5 });
      expect(r.asOf).toBe(TODAY);
    });

    test("the report rows are mapped to the same figures as the register (input mapping, same shared engine)", async () => {
      const a = await mkActive({ description: `Cohérence ${sfx}`, paMinor: "60000", faaMinor: "0", inServiceDate: "2026-07-01", acquisitionDate: "2026-07-01", method: "degressif", usefulLifeYears: 5 });
      for (const asOf of ["2026-09-30", "2027-12-31", "2031-12-31"]) {
        const reg = await json(await call("admin", "GET", `/${a.id}?asOf=${asOf}`));
        const rep = (await data(`q=${encodeURIComponent(`Cohérence ${sfx}`)}&asOf=${asOf}`)).rows.map(toSource).map((s: AssetReportSource) => toReportRow(s, asOf))[0];
        expect([rep.exerciseMinor.toString(), rep.accumulatedMinor.toString(), rep.vncMinor.toString()]).toEqual([reg.exerciseMinor, reg.accumulatedMinor, reg.vncMinor]);
      }
    });

    test("filters narrow the data; reports stay per currency", async () => {
      const marker = `Devises-${sfx}`;
      await mkActive({ description: `${marker} usd`, currency: "USD" });
      await mkActive({ description: `${marker} cdf`, currency: "CDF", fxRatePerUsd: "2800", locationId: ids.locTemple });
      const all = await data(`q=${marker}`);
      const rows = all.rows.map(toSource).map((s: AssetReportSource) => toReportRow(s, TODAY));
      const vnc = reportVnc(rows);
      expect(vnc.totals.map((t) => t.currency)).toEqual(["CDF", "USD"]);
      expect(vnc.totals[0]!.usd).not.toBeNull(); // CDF carries its frozen rate
      expect(reportParEtat(rows).lines.find((l) => l.key === "bon")!.count).toBe(2);
      expect((await data(`q=${marker}&currency=CDF`)).rows).toHaveLength(1);
      expect((await data(`q=${marker}&locationId=${ids.locTemple}`)).rows).toHaveLength(1);
      expect((await data(`q=${marker}&account=22`)).rows).toHaveLength(0);
    });

    test("access follows transaction.readAll; other parishes' assets are never included", async () => {
      expect((await call("caissier", "GET", "/reports/data")).status).toBe(403);
      expect((await call("auditeur", "GET", "/reports/data")).status).toBe(200);
      const b = await data("", "tresorierB", ids.parishB);
      expect(b.rows.every((r: any) => r.id && r.locationName)).toBe(true);
      const act = await mkActive({ description: `Isolé ${sfx}` });
      expect(b.rows.some((r: any) => r.id === act.id)).toBe(false);
    });
  });


  // ---- inventory ---------------------------------------------------------------------------------------------------------------

  describe("inventaire", () => {
    let locId = ""; // a location of its own, so the counts are exact
    const inv = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) => call(as, method, `/inventories${path}`, body, parish);
    const lineOf = (detail: any, code: string) => detail.lines.find((l: any) => l.expectedCode === code);
    const mk = async (description: string, extra: Record<string, unknown> = {}) => mkActive({ description, locationId: locId, ...extra });

    beforeAll(async () => {
      const r = await json(await call("admin", "POST", "/refs/locations", { name: `Chapelle ${sfx}` }));
      locId = r.id;
    });

    test("an inventory freezes the validated assets of a location as the théorique", async () => {
      const a = await mk(`Inv A ${sfx}`), b = await mk(`Inv B ${sfx}`);
      await mkDraft({ description: `Inv brouillon ${sfx}`, locationId: locId }); // not validated: not inventoried
      await mkActive({ description: `Inv ailleurs ${sfx}`, locationId: ids.locTemple }); // another location
      const r = await inv("admin", "POST", "", { locationId: locId });
      expect(r.status).toBe(201);
      const d = await json(r);
      expect(d.reference).toMatch(new RegExp(`^INV-IA${sfx}-\\d{4}-\\d{6}$`));
      expect([d.status, d.locationName, d.startedOn]).toEqual(["en_cours", `Chapelle ${sfx}`, TODAY]);
      expect(d.lines.map((l: any) => l.expectedCode).sort()).toEqual([a.code, b.code].sort());
      expect(d.lines.every((l: any) => l.present === null && l.expectedEtat === "bon" && l.expectedLocationName === `Chapelle ${sfx}`)).toBe(true);
      expect(d.summary).toMatchObject({ total: 2, checked: 0, remaining: 2 });
      const second = await json(await inv("admin", "POST", "", { locationId: locId }));
      expect(Number(second.reference.split("-").pop())).toBe(Number(d.reference.split("-").pop()) + 1);
    });

    test("nothing to inventory, nothing created", async () => {
      const empty = await json(await call("admin", "POST", "/refs/locations", { name: `Vide ${sfx}` }));
      const before = (await json(await inv("admin", "GET", ""))).length;
      const r = await inv("admin", "POST", "", { locationId: empty.id });
      expect(r.status).toBe(422);
      expect((await json(await inv("admin", "GET", ""))).length).toBe(before);
      expect((await inv("admin", "POST", "", { locationId: ids.locB })).status).toBe(422); // another parish's location
    });

    test("checking the lines and the écarts: absent, found elsewhere, other état, not in the register", async () => {
      const loc2 = await json(await call("admin", "POST", "/refs/locations", { name: `Autre ${sfx}` }));
      const own = (await json(await call("admin", "POST", "/refs/locations", { name: `Comptage ${sfx}` }))).id; // its own location: exact counts
      const asset = (description: string) => mkActive({ description, locationId: own });
      const [a, b, c, e] = [await asset(`Chk A ${sfx}`), await asset(`Chk B ${sfx}`), await asset(`Chk C ${sfx}`), await asset(`Chk D ${sfx}`)];
      const d = await json(await inv("admin", "POST", "", { locationId: own }));
      const mine = [a, b, c, e].map((x) => lineOf(d, x.code));
      const put = (line: any, body: unknown, as = "admin") => inv(as, "PUT", `/${d.id}/lines/${line.id}`, body);

      // "Présent" alone = found where and as the register says
      const ok = await json(await put(mine[0], { present: true }));
      expect([ok.present, ok.foundLocationId, ok.foundEtat, ok.checkedAt !== null]).toEqual([true, own, "bon", true]);
      expect((await json(await put(mine[1], { present: true, foundLocationId: loc2.id, foundEtat: "mauvais", responsible: "Service Social", observation: "Déplacée" }))).responsible).toBe("Service Social");
      const abs = await json(await put(mine[2], { present: false, foundLocationId: loc2.id, foundEtat: "perdu" })); // found data is ignored for an absent asset
      expect([abs.present, abs.foundLocationId, abs.foundEtat]).toEqual([false, null, null]);
      expect((await put(mine[3], { present: true, foundLocationId: ids.locB })).status).toBe(422); // another parish's location

      const f = await json(await inv("admin", "POST", `/${d.id}/lines`, { description: "Climatiseur sans étiquette", foundLocationId: loc2.id, observation: "Don ?" }));
      expect([f.assetId, f.present, f.extraDescription, f.foundEtat]).toEqual([null, true, "Climatiseur sans étiquette", "bon"]);

      const after = await json(await inv("auditeur", "GET", `/${d.id}`));
      expect(after.summary).toEqual({ total: 5, checked: 4, remaining: 1, present: 3, conformes: 1, absents: 1, autreLocalisation: 1, etatDifferent: 1, nonEnregistres: 1 });
      expect(lineOf(after, mine[1].expectedCode)).toMatchObject({ foundLocationName: `Autre ${sfx}`, checkedByName: "admin" });

      // the inventory only reports: no asset was touched
      const untouched = await json(await call("admin", "GET", `/${c.id}`));
      expect([untouched.etat, untouched.locationId, untouched.statut]).toEqual(["bon", own, "actif"]);

      // a find can be taken back, a line of the théorique cannot
      expect((await inv("admin", "DELETE", `/${d.id}/lines/${f.id}`)).status).toBe(204);
      expect((await inv("admin", "DELETE", `/${d.id}/lines/${mine[0].id}`)).status).toBe(422);
      await expect(sqlRows("delete from asset_inventory_lines where id = $1", [mine[0].id])).rejects.toThrow(/théorique/);
    });

    test("the théorique does not move when the register does", async () => {
      const a = await mk(`Fige ${sfx}`);
      const d = await json(await inv("admin", "POST", "", { locationId: locId }));
      const line = lineOf(d, a.code);
      await call("admin", "POST", `/${a.id}/etat`, { newEtat: "mauvais", reason: "Panne", observation: "Cassé" });
      const again = await json(await inv("admin", "GET", `/${d.id}`));
      expect(lineOf(again, a.code)).toMatchObject({ expectedEtat: "bon", expectedDescription: `Fige ${sfx}` });
      await expect(sqlRows("update asset_inventory_lines set expected_etat = 'perdu' where id = $1", [line.id])).rejects.toThrow(/théorique/);
    });

    test("an inventory closes only when every asset was checked, and is then frozen", async () => {
      const a = await mk(`Clot A ${sfx}`), b = await mk(`Clot B ${sfx}`);
      const d = await json(await inv("admin", "POST", "", { locationId: locId }));
      const la = lineOf(d, a.code), lb = lineOf(d, b.code);
      const early = await inv("admin", "POST", `/${d.id}/close`);
      expect(early.status).toBe(422);
      expect((await json(early)).error).toMatch(/non vérifiée/);

      for (const l of d.lines) await inv("admin", "PUT", `/${d.id}/lines/${l.id}`, { present: l.id !== lb.id });
      const closed = await json(await inv("admin", "POST", `/${d.id}/close`));
      expect(closed.status).toBe("cloture");
      expect(closed.closedAt).toBeTruthy();
      expect(closed.summary.remaining).toBe(0);

      // frozen: through the API and in the database
      expect((await inv("admin", "PUT", `/${d.id}/lines/${la.id}`, { present: false })).status).toBe(422);
      expect((await inv("admin", "POST", `/${d.id}/lines`, { description: "Tard", foundLocationId: locId })).status).toBe(422);
      expect((await inv("admin", "POST", `/${d.id}/close`)).status).toBe(422);
      await expect(sqlRows("update asset_inventory_lines set present = true where id = $1", [lb.id])).rejects.toThrow(/Inventaire clôturé/);
      await expect(sqlRows("update asset_inventories set observations = 'x' where id = $1", [d.id])).rejects.toThrow(/Inventaire clôturé/);
      await expect(sqlRows("delete from asset_inventories where id = $1", [d.id])).rejects.toThrow(/en ajout seul/);
      const audit = await sqlRows("select action from audit_log where entity = 'asset_inventory' and entity_id = $1 order by at", [d.id]);
      const actions = audit.map((r) => r.action);
      expect([actions[0], actions.at(-1)]).toEqual(["asset.inventory.create", "asset.inventory.close"]);
      expect(actions.slice(1, -1).length).toBeGreaterThan(0);
      expect(actions.slice(1, -1).every((a) => a === "asset.inventory.check")).toBe(true); // every check is traced
    });

    test("only registrars run an inventory; readers may look; other parishes see nothing", async () => {
      await mk(`Droits ${sfx}`);
      const d = await json(await inv("admin", "POST", "", { locationId: locId }));
      for (const as of ["auditeur", "caissier", "evang"]) expect((await inv(as, "POST", "", { locationId: locId })).status).toBe(403);
      expect((await inv("auditeur", "PUT", `/${d.id}/lines/${d.lines[0].id}`, { present: true })).status).toBe(403);
      expect((await inv("auditeur", "POST", `/${d.id}/close`)).status).toBe(403);
      expect((await inv("auditeur", "GET", `/${d.id}`)).status).toBe(200);
      expect((await inv("caissier", "GET", "")).status).toBe(403);
      expect((await inv("tresorierB", "GET", `/${d.id}`, undefined, ids.parishB)).status).toBe(404);
      expect((await inv("adminB", "PUT", `/${d.id}/lines/${d.lines[0].id}`, { present: true }, ids.parishB)).status).toBe(404);
      expect((await json(await inv("tresorierB", "GET", "", undefined, ids.parishB))).some((x: any) => x.id === d.id)).toBe(false);
    });
  });


  // ---- regressions found by the code review ------------------------------------------------------------------------------------

  describe("revue de code", () => {
    test("one person holding both approval roles cannot sign both levels", async () => {
      const a = await mkDraft();
      const sub = await json(await call("admin", "POST", `/${a.id}/submit`));
      expect((await approve1(sub.request.id, "both")).status).toBe(200);
      const second = await approve2(sub.request.id, "both");
      expect(second.status).toBe(422);
      expect((await json(second)).error).toContain("deux personnes différentes");
      expect((await json(await call("admin", "GET", `/${a.id}`))).statut).toBe("en_attente_validation");
      expect((await approve2(sub.request.id, "pasteur")).status).toBe(200); // a second person can
      expect((await json(await call("admin", "GET", `/${a.id}`))).statut).toBe("actif");
    });

    test("whoever entered an asset does not validate it, even if a colleague submitted it", async () => {
      const a = await mkDraft({}, "tresorier"); // entered by the Trésorier…
      const sub = await json(await call("admin", "POST", `/${a.id}/submit`)); // …submitted by the administrateur
      const own = await approve1(sub.request.id, "tresorier");
      expect(own.status).toBe(422);
      expect((await json(own)).error).toContain("saisi");
      expect((await approve1(sub.request.id, "both")).status).toBe(200); // another Trésorier does
      expect((await approve2(sub.request.id)).status).toBe(200);
      // they can still refuse it
      const b = await mkDraft({}, "tresorier");
      const sb = await json(await call("admin", "POST", `/${b.id}/submit`));
      expect((await call("tresorier", "POST", `/requests/${sb.request.id}/reject`, { comment: "Erreur de saisie" })).status).toBe(200);
    });

    test("asset files are not reachable, nor deletable, through the registers' file endpoints", async () => {
      const act = await mkActive();
      const f = await json(await upload("admin", act.id, new File([new Uint8Array([37, 80, 68, 70])], "facture.pdf", { type: "application/pdf" })));
      const viaRegistres = (as: string, method: string) =>
        app.request(`/api/registres/files/${f.id}`, { method, headers: { authorization: `Bearer ${as}-${sfx}`, "x-parish-id": ids.parishA! } }, env);
      for (const as of ["admin", "caissier", "pasteur"]) {
        expect((await viaRegistres(as, "GET")).status).toBe(404);
        expect((await viaRegistres(as, "DELETE")).status).not.toBe(204);
      }
      expect(await json(await call("admin", "GET", `/${act.id}/files`))).toHaveLength(1); // still there
    });

    test("amounts beyond the limit are a clear 400, never a 500 — including in a modification request", async () => {
      for (const paMinor of ["99999999999999999999", "1000000000000001", 1e21]) expect((await call("admin", "POST", "", draft({ paMinor }))).status).toBe(400);
      expect((await call("admin", "POST", "", draft({ paMinor: "1000000000000000", faaMinor: "1" }))).status).toBe(400); // the sum
      const act = await mkActive();
      const r = await request("admin", act.id, { kind: "modification", reason: "Correction du prix", changes: { paMinor: "99999999999999999999" } });
      expect(r.status).toBe(400); // refused when asked, not when the Pasteur approves
      expect((await request("admin", act.id, { kind: "modification", reason: "Correction du prix", changes: { faaMinor: "1000000000000000" } })).status).toBe(422); // PA + FAA together
    });

    test("an exceptional code change onto a future number does not block new codes", async () => {
      await call("admin", "POST", "/refs/prefixes", { acronym: "QZ", label: "Essai" });
      const first = await mkActive({ acronym: "QZ", subaccountCode: "24.1" });
      expect(first.code).toBe(`QZ ${PERIOD} 00001`);
      const req = await json(await request("admin", first.id, { kind: "modification", reason: "Code erroné", changes: { code: `QZ ${PERIOD} 00003` } }));
      await approve1(req.id); await approve2(req.id);
      const codes: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await call("admin", "POST", "", draft({ acronym: "QZ", subaccountCode: "24.1" }));
        expect(r.status).toBe(201);
        codes.push((await json(r)).code);
      }
      expect(codes).toEqual([`QZ ${PERIOD} 00002`, `QZ ${PERIOD} 00004`, `QZ ${PERIOD} 00005`]); // 00003 is taken and skipped
    });

    test("the sequence grows past 99999 instead of wrapping onto an existing number", async () => {
      await sqlRows("insert into asset_code_counters (parish_id, acronym, period, last_value) values ($1, 'WZ', '202601', 99999)", [ids.parishA]);
      const [{ code }] = await sqlRows("select next_asset_code($1, 'WZ', '202601') as code", [ids.parishA]);
      expect(code).toBe("WZ 202601 100000");
    });

    test("the audit trail and request events keep the order in which things happened", async () => {
      const act = await mkActive();
      const req = await json(await request("admin", act.id, { kind: "modification", reason: "Déménagement", changes: { locationId: ids.locTemple } }));
      await approve1(req.id); await approve2(req.id);
      const trail = (await json(await call("admin", "GET", `/${act.id}/audit`))).map((e: any) => e.action);
      expect(trail.slice(-5)).toEqual(["asset.request.create", "asset.request.approve1", "asset.request.approve2", "asset.modify", "asset.request.execute"]);
      const events = (await json(await call("admin", "GET", `/requests/${req.id}`))).events.map((e: any) => e.toStatus);
      expect(events).toEqual(["en_attente_tresorier", "approuvee_n1", "approuvee_n2", "executee"]);
    });

    test("changing the currency in a modification drops the old exchange rate; a new rate is dated", async () => {
      const act = await mkActive({ currency: "CDF", fxRatePerUsd: "2800" });
      const req = await json(await request("admin", act.id, { kind: "modification", reason: "Devise corrigée", changes: { currency: "EUR" } }));
      expect(req.proposedChanges).toEqual({ currency: "EUR", fxRatePerUsd: null });
      expect(req.oldValues).toEqual({ currency: "CDF", fxRatePerUsd: "2800" });
      await approve1(req.id); await approve2(req.id);
      const a = await json(await call("admin", "GET", `/${act.id}`));
      expect([a.currency, a.fxRatePerUsd, a.fxRateDate]).toEqual(["EUR", null, null]);
      const req2 = await json(await request("admin", act.id, { kind: "modification", reason: "Taux connu", changes: { fxRatePerUsd: "0.9234" } }));
      await approve1(req2.id); await approve2(req2.id);
      const b = await json(await call("admin", "GET", `/${act.id}`));
      expect([b.fxRatePerUsd, b.fxRateDate]).toEqual(["0.9234", TODAY]);
    });

    test("dates must be coherent: no mise en service before the acquisition, no future acquisition", async () => {
      expect((await call("admin", "POST", "", draft({ acquisitionDate: "2026-10-10", inServiceDate: "2010-01-01" }))).status).toBe(400);
      const future = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      expect((await call("admin", "POST", "", draft({ acquisitionDate: future, inServiceDate: future }))).status).toBe(400);
    });

    test("bad input is the caller's mistake (4xx), never an internal error", async () => {
      const act = await mkActive();
      // impossible calendar days and absurd page numbers
      expect((await call("admin", "GET", "?q=2026-02-30")).status).toBe(200); // just a search text that matches nothing
      for (const qs of ["?to=2026-02-30", "?from=2026-13-45", "?page=1000000000000000000", "/reports/data?from=2026-02-30"]) expect((await call("admin", "GET", qs)).status).toBe(400);
      // identifiers that are not uuids
      for (const path of ["/abc", "/abc/etat-history", "/abc/audit", "/abc/files", "/requests/abc", "/files/abc", "/inventories/abc"]) {
        const r = await call("admin", "GET", path);
        expect(r.status).toBeLessThan(500);
        expect(r.status).toBeGreaterThanOrEqual(400);
      }
      expect((await call("admin", "POST", "/abc/submit")).status).toBeLessThan(500);
      // empty updates of the referentials
      const loc = await json(await call("admin", "POST", "/refs/locations", { name: `Vide-patch ${sfx}` }));
      expect((await call("admin", "PATCH", `/refs/locations/${loc.id}`, {})).status).toBe(400);
      expect(act.id).toBeTruthy();
    });

    test("deleting a draft removes its attached files, in the database and in storage", async () => {
      const dr = await mkDraft();
      const f = await json(await upload("admin", dr.id, new File([new Uint8Array([37, 80, 68, 70])], "devis.pdf", { type: "application/pdf" })));
      const before = bucket.size;
      expect((await call("admin", "DELETE", `/${dr.id}`)).status).toBe(204);
      expect(bucket.size).toBe(before - 1);
      expect((await call("admin", "GET", `/files/${f.id}`)).status).toBe(404);
      expect(await sqlRows("select 1 from record_files where id = $1", [f.id])).toHaveLength(0);
    });

    test("every inventory check, and every re-check, is in the audit trail with what it replaced", async () => {
      const own = (await json(await call("admin", "POST", "/refs/locations", { name: `Trace ${sfx}` }))).id;
      const a = await mkActive({ description: `Trace ${sfx}`, locationId: own });
      const d = await json(await call("admin", "POST", "/inventories", { locationId: own }));
      const line = d.lines[0];
      await call("admin", "PUT", `/inventories/${d.id}/lines/${line.id}`, { present: true });
      await call("admin", "PUT", `/inventories/${d.id}/lines/${line.id}`, { present: false });
      const rows = await sqlRows("select before, after from audit_log where entity = 'asset_inventory' and entity_id = $1 and action = 'asset.inventory.check' order by at, id", [d.id]);
      expect(rows.map((r) => [r.before.present, r.after.present])).toEqual([[null, true], [true, false]]);
      expect(a.code).toBe(rows[0]!.after.code);
    });

    test("the quick \"Présent\" on an already-checked line keeps where and how it was found", async () => {
      const loc2 = await json(await call("admin", "POST", "/refs/locations", { name: `Ailleurs ${sfx}` }));
      const own = (await json(await call("admin", "POST", "/refs/locations", { name: `Garde ${sfx}` }))).id;
      await mkActive({ description: `Garde ${sfx}`, locationId: own });
      const d = await json(await call("admin", "POST", "/inventories", { locationId: own }));
      const line = d.lines[0];
      const put = (body: unknown) => call("admin", "PUT", `/inventories/${d.id}/lines/${line.id}`, body);
      await put({ present: true, foundLocationId: loc2.id, foundEtat: "mauvais" });
      // what the screen sends when "Présent" is pressed again: the recorded values, sent back
      const again = await json(await put({ present: true, foundLocationId: loc2.id, foundEtat: "mauvais", responsible: null, observation: null }));
      expect([again.foundLocationId, again.foundEtat]).toEqual([loc2.id, "mauvais"]);
    });
  });

  // ---- parish isolation -------------------------------------------------------------------------------------------------------------------------------

  describe("parish isolation", () => {
    test("assets, requests and history of parish A are invisible and untouchable from parish B", async () => {
      const act = await mkActive();
      const req = await json(await request("admin", act.id, { kind: "annulation", reason: "Saisie en double" }));
      const asB = (as: string, method: string, path: string, body?: unknown) => call(as, method, path, body, ids.parishB);

      const list = await json(await asB("tresorierB", "GET", ""));
      expect(list.rows.some((r: any) => r.id === act.id)).toBe(false);
      for (const path of [`/${act.id}`, `/${act.id}/etat-history`, `/${act.id}/audit`, `/requests/${req.id}`]) expect((await asB("tresorierB", "GET", path)).status).toBe(404);
      expect((await asB("adminB", "PATCH", `/${act.id}`, draft({ locationId: ids.locB }))).status).toBe(404);
      expect((await asB("adminB", "POST", `/${act.id}/etat`, { newEtat: "mauvais", reason: "Contrôle", observation: "Constat" })).status).toBe(404);
      expect((await asB("adminB", "POST", `/${act.id}/requests`, { kind: "annulation", reason: "Intrus" })).status).toBe(404);
      expect((await asB("tresorierB", "POST", `/requests/${req.id}/approve1`)).status).toBe(404);
      expect((await json(await asB("tresorierB", "GET", "/requests"))).some((r: any) => r.id === req.id)).toBe(false);

      // a user of parish B cannot even reach parish A by naming it
      expect((await call("tresorierB", "GET", "", undefined, ids.parishA)).status).toBe(403);
      // the referentials are separate too
      const refsB = await json(await asB("tresorierB", "GET", "/refs"));
      expect(refsB.locations.every((l: any) => l.parishId === ids.parishB)).toBe(true);
    });
  });
});

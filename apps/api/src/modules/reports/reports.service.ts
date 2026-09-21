import type { Tx } from "@church/db";
import type { ReportQuery as Q } from "./reports.dto";
import * as repo from "./reports.repo";

/** Parish scope of the request (null = all parishes the user can see). */
export type Actor = { parishId: string | null };

const big = (v: unknown) => BigInt(String(v ?? 0));
const zero = 0n;

type Tot = { currency: string; [k: string]: string };
/** Sum named bigint fields per currency. */
function sumBy(rows: Record<string, any>[], fields: string[]): Tot[] {
  const m = new Map<string, Record<string, bigint>>();
  for (const r of rows) {
    const acc = m.get(r.currency) ?? Object.fromEntries(fields.map((f) => [f, zero]));
    for (const f of fields) acc[f] = acc[f]! + big(r[f]);
    m.set(r.currency, acc);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.toString()])) }));
}

/** Per account: opening (validated, before `from`), entrées, sorties in period, closing. */
async function balances(tx: Tx, q: Q, parishId: string | null) {
  const rows = await repo.accountBalances(tx, q, parishId);
  return [...rows].map((r: any) => ({
    accountId: r.id as string, account: r.name as string, type: r.type as string, currency: r.currency as string,
    opening: r.opening as string, entrees: r.entrees as string, sorties: r.sorties as string,
    closing: (big(r.opening) + big(r.entrees) - big(r.sorties)).toString(),
  }));
}

const CULTE_FIELDS = ["m_adulte", "m_enfant", "m_bebe", "f_adulte", "f_enfant", "f_bebe"] as const;
const camel = (s: string) => s.replace(/_(\w)/g, (_, x) => x.toUpperCase());

export async function listUsers(tx: Tx, actor: Actor) {
  const rows = await repo.listScopeUsers(tx, actor.parishId);
  return [...rows].map((r: any) => ({ id: r.id, fullName: r.full_name }));
}

export async function journal(tx: Tx, actor: Actor, q: Q) {
  const { parishId } = actor;
  const rows = await repo.journalRows(tx, q, parishId);
  const opening = q.from ? await repo.journalOpening(tx, q, parishId) : [];
  const items = rows.map((r) => ({
    id: r.id, date: r.date, reference: r.reference, kind: r.kind, account: r.account, category: r.category, description: r.description,
    entree: r.direction === "in" ? r.amount : null, sortie: r.direction === "out" ? r.amount : null,
    currency: r.currency, status: r.status, enteredBy: r.entered_by, validator1: r.validator1, validator2: r.validator2,
  }));
  // Totals and closing balance count validated lines only (same rule as the journal balance).
  const val = rows.filter((r) => r.status === "validee").map((r) => ({ currency: r.currency, entrees: r.direction === "in" ? r.amount : "0", sorties: r.direction === "out" ? r.amount : "0" }));
  const cur = new Set<string>([...opening.map((o) => o.currency), ...rows.map((r) => r.currency)]);
  const totals = [...cur].sort().map((currency) => {
    const t = sumBy(val, ["entrees", "sorties"]).find((x) => x.currency === currency) ?? { entrees: "0", sorties: "0" };
    const op = big(opening.find((o) => o.currency === currency)?.opening);
    return { currency, opening: op.toString(), entrees: t.entrees!, sorties: t.sorties!, closing: (op + big(t.entrees) - big(t.sorties)).toString() };
  });
  return { rows: items, totals, meta: { count: items.length, truncated: rows.length >= 5000 } };
}

export async function soldesParCompte(tx: Tx, actor: Actor, q: Q) {
  const rows = await balances(tx, q, actor.parishId);
  return { rows, totals: sumBy(rows, ["opening", "entrees", "sorties", "closing"]), meta: { from: q.from ?? null, to: q.to ?? null } };
}

export async function consolide(tx: Tx, actor: Actor, q: Q) {
  const acc = await balances(tx, q, actor.parishId);
  const groups = new Map<string, any[]>();
  for (const a of acc) { const k = `${a.type}|${a.currency}`; groups.set(k, [...(groups.get(k) ?? []), a]); }
  const rows = [...groups].map(([k, list]) => {
    const [type, currency] = k.split("|") as [string, string];
    return { type, accounts: list.length, ...sumBy(list, ["opening", "entrees", "sorties", "closing"])[0]! };
  });
  return { rows, totals: sumBy(acc, ["opening", "entrees", "sorties", "closing"]), meta: { from: q.from ?? null, to: q.to ?? null } };
}

export async function transferts(tx: Tx, actor: Actor, q: Q) {
  const legs = await repo.transferLegs(tx, q, actor.parishId);
  const groups = new Map<string, any[]>();
  for (const l of legs as any[]) groups.set(l.grp, [...(groups.get(l.grp) ?? []), l]);
  const rows = [...groups.values()].map((g) => {
    const out = g.find((x) => x.direction === "out"); const inn = g.find((x) => x.direction === "in");
    return {
      group: out?.grp ?? inn?.grp, date: (out ?? inn).date, kind: (out ?? inn).kind, source: out?.account ?? null, destination: inn?.account ?? null,
      currency: out?.currency ?? inn?.currency, amount: out?.amount ?? inn?.amount, receivedCurrency: inn?.currency ?? null, receivedAmount: inn?.amount ?? null,
      rate: (out ?? inn).kind === "change" ? (out ?? inn).rate_used : null,
      // No fee is linked to a transfer group in the schema (fees are separate "frais" dépenses).
      fees: null, status: (out ?? inn).status,
    };
  });
  return { rows, totals: sumBy(rows, ["amount"]), meta: { count: rows.length } };
}

export async function engagements(tx: Tx, actor: Actor, q: Q) {
  const all = await repo.engagementRows(tx, q, actor.parishId);
  const data = all.map((r) => {
    const solde = big(r.engage) - big(r.libere);
    return { id: r.id, nature: r.nature, name: r.name, type: r.type, category: r.category, currency: r.currency, dueDate: r.due_date,
      engage: r.engage, libere: r.libere, nonLibere: (solde > 0n ? solde : zero).toString(), solde: solde.toString() };
  });
  return { rows: data, totals: sumBy(data, ["engage", "libere", "nonLibere", "solde"]), meta: { count: data.length } };
}

export async function effectifs(tx: Tx, actor: Actor, q: Q) {
  const recs = await repo.attendanceRows(tx, q, actor.parishId, CULTE_FIELDS);
  const days = new Map<string, number>();
  const seen = new Set<string>();
  const rows = (recs as any[]).map((r) => {
    const counts = Object.fromEntries(CULTE_FIELDS.map((f) => [camel(f), Number(r[f])])) as Record<string, number>;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    days.set(r.date, (days.get(r.date) ?? 0) + total);
    return { id: r.id, date: r.date, serviceType: r.service_type, ...counts, total, dayTotal: null as number | null };
  });
  for (const r of rows) if (!seen.has(r.date)) { seen.add(r.date); r.dayTotal = days.get(r.date)!; }
  const keys = [...CULTE_FIELDS.map(camel), "total"];
  const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + (r as any)[k], 0)]));
  return { rows, totals, meta: { count: rows.length, days: [...days].map(([date, total]) => ({ date, total })) } };
}

export async function membres(tx: Tx, actor: Actor, q: Q) {
  const rows = await repo.memberRows(tx, q, actor.parishId);
  return { rows: [...rows].map((r: any) => ({ id: r.id, fullName: r.full_name, phone: r.phone, whatsapp: r.whatsapp, email: r.email, address: r.address, homeChurch: r.home_church, invitedBy: r.invited_by, since: r.since })), totals: [], meta: { count: rows.length } };
}

export async function ouvriers(tx: Tx, actor: Actor, q: Q) {
  const rows = await repo.workerRows(tx, q, actor.parishId);
  return { rows: [...rows].map((r: any) => ({ id: r.id, fullName: r.full_name, category: r.category, department: r.department, phone: r.phone, email: r.email, whatsapp: r.whatsapp, address: r.address, basicTeaching: r.basic_teaching_done, active: r.active })), totals: [], meta: { count: rows.length } };
}

async function register(tx: Tx, actor: Actor, q: Q, table: string, dateCol: string, cols: string, map: (r: any) => Record<string, unknown>) {
  const rows = await repo.registerRows(tx, q, actor.parishId, table, dateCol, cols);
  return { rows: [...rows].map(map), totals: [], meta: { count: rows.length } };
}

export const dedicaces = (tx: Tx, actor: Actor, q: Q) => register(tx, actor, q, "child_dedications", "date", "id, date::text as date, child_name, mother_name, father_name, pastor_name, form_completed",
  (r) => ({ id: r.id, date: r.date, childName: r.child_name, motherName: r.mother_name, fatherName: r.father_name, pastorName: r.pastor_name, formCompleted: r.form_completed }));
export const baptemes = (tx: Tx, actor: Actor, q: Q) => register(tx, actor, q, "baptisms", "date", "id, date::text as date, full_name, place, address, phone, email, whatsapp, pastor_name",
  (r) => ({ id: r.id, date: r.date, fullName: r.full_name, place: r.place, address: r.address, phone: r.phone, email: r.email, whatsapp: r.whatsapp, pastorName: r.pastor_name }));
export const mariages = (tx: Tx, actor: Actor, q: Q) => register(tx, actor, q, "marriages", "date", "id, date::text as date, husband_name, wife_name, couple_address, phone, pastor_name, blessing_place",
  (r) => ({ id: r.id, date: r.date, husbandName: r.husband_name, wifeName: r.wife_name, coupleAddress: r.couple_address, phone: r.phone, pastorName: r.pastor_name, blessingPlace: r.blessing_place }));

export async function byCategory(tx: Tx, actor: Actor, q: Q, kind: "recette" | "depense") {
  const rows = await repo.totalsByCategory(tx, q, actor.parishId, kind);
  const items = [...rows].map((r: any) => ({ categoryId: r.category_id, category: r.category, group: r.grp, currency: r.currency, count: r.count, total: r.total as string }));
  return { rows: items, totals: sumBy(items, ["total"]).map((t) => ({ ...t, count: String(items.filter((i) => i.currency === t.currency).reduce((a, i) => a + i.count, 0)) })), meta: { kind, statuses: q.status ?? "validee" } };
}

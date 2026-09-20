import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Save, Send, Users, X } from "lucide-react";
import { CULTE_TYPES } from "@church/shared";
import { Input } from "@/components/ui/input";
import { ActionButton, Card, DataTable, ErrorNote, ReasonButton, StatusBadge } from "@/components/common";
import { DatePicker, DateRangePicker, OptionSelect, dateLimits } from "@/components/form-controls";
import { ValidationFlowButton, countByStatus } from "../validation/ValidationFlow";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { ExportButtons } from "./ExportButtons";

export interface Att { id: string; serviceDate: string; serviceType: string; mAdulte: number; mEnfant: number; mBebe: number; fAdulte: number; fEnfant: number; fBebe: number; status: any; enteredBy: string }
const KEYS = ["mAdulte", "mEnfant", "mBebe", "fAdulte", "fEnfant", "fBebe"] as const;
type K = (typeof KEYS)[number];
const LABELS: Record<K, string> = { mAdulte: "Hommes", mEnfant: "Garçons", mBebe: "Bébés (M)", fAdulte: "Femmes", fEnfant: "Filles", fBebe: "Bébés (F)" };
const SHORT: Record<K, string> = { mAdulte: "M adultes", mEnfant: "M enfants", mBebe: "M bébés", fAdulte: "F adultes", fEnfant: "F enfants", fBebe: "F bébés" };
const total = (a: Partial<Record<K, number>>) => KEYS.reduce((n, k) => n + (a[k] ?? 0), 0);
const editable = (a: Att | undefined, me: string) => !a || (a.enteredBy === me && (a.status === "brouillon" || a.status === "rejetee"));
type Grid = Record<string, Record<K, string>>;
const empty = (): Record<K, string> => ({ mAdulte: "", mEnfant: "", mBebe: "", fAdulte: "", fEnfant: "", fBebe: "" });
const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

export function AttendanceTab() {
  const s = useSession();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  return (
    <>
      {canEnter && <DayEntry />}
      <History />
    </>
  );
}

function DayEntry() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const me = s.me.user.id;
  const [date, setDate] = useState(today());
  const day = useQuery({ queryKey: useScopedKey("attendance", "day", date), queryFn: () => api.get<Att[]>("/effectifs/attendance", { from: date, to: date }) });
  const byType = useMemo(() => new Map((day.data ?? []).map((a) => [a.serviceType, a])), [day.data]);
  const [grid, setGrid] = useState<Grid>({});
  useEffect(() => {
    const g: Grid = {};
    for (const t of CULTE_TYPES) {
      const a = byType.get(t);
      g[t] = a ? Object.fromEntries(KEYS.map((k) => [k, String(a[k])])) as Record<K, string> : empty();
    }
    setGrid(g);
  }, [byType, date]);
  const nums = (t: string) => Object.fromEntries(KEYS.map((k) => [k, num(grid[t]?.[k] ?? "")])) as Record<K, number>;
  const dayTotal = CULTE_TYPES.reduce((n, t) => n + total(nums(t)), 0);
  const payload = () => ({ date, cultes: CULTE_TYPES.filter((t) => editable(byType.get(t), me) && (byType.has(t) || total(nums(t)) > 0)).map((t) => ({ serviceType: t, counts: nums(t) })) });
  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const body = payload();
      if (!body.cultes.length) throw new Error("Aucun effectif à enregistrer");
      const rows = await api.post<Att[]>("/effectifs/attendance/day", body);
      if (submit) for (const r of rows) await api.post(`/effectifs/attendance/${r.id}/submit`, {});
    },
    onSuccess: invalidate,
  });
  const set = (t: string, k: K, v: string) => setGrid((g) => ({ ...g, [t]: { ...g[t]!, [k]: v.replace(/[^\d]/g, "") } }));
  const anyEditable = CULTE_TYPES.some((t) => editable(byType.get(t), me));

  return (
    <Card title="Saisie de la journée" actions={<DatePicker value={date} onChange={(v) => v && setDate(v)} {...dateLimits.past()} />}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CULTE_TYPES.map((t) => {
          const a = byType.get(t); const ok = editable(a, me);
          return (
            <div key={t} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <b className="text-sm">{t}</b>{a && <StatusBadge status={a.status} />}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {KEYS.map((k) => (
                  <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">{LABELS[k]}
                    <Input inputMode="numeric" className="h-8 text-right" disabled={!ok} value={grid[t]?.[k] ?? ""} placeholder="0" onChange={(e) => set(t, k, e.target.value)} aria-label={`${t} — ${SHORT[k]}`} />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-right text-xs text-muted-foreground">Total du culte : <b className="text-foreground">{total(nums(t))}</b></p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">Total général de la journée : <b>{dayTotal}</b></p>
        <span className="flex gap-2">
          <ActionButton variant="outline" icon={Save} disabled={!anyEditable} pending={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Enregistrer</ActionButton>
          <ActionButton icon={Send} disabled={!anyEditable} pending={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Soumettre la journée</ActionButton>
        </span>
      </div>
      <ErrorNote error={save.error} />
    </Card>
  );
}

function History() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  const [range, setRange] = useState({ from: "", to: "" });
  const [type, setType] = useState("");
  const list = useQuery({ queryKey: useScopedKey("attendance", "list", range.from, range.to, type), queryFn: () => api.get<Att[]>("/effectifs/attendance", { from: range.from || undefined, to: range.to || undefined, serviceType: type || undefined }) });
  const act = useMutation({ mutationFn: (v: { id: string; action: string; comment?: string }) => api.post(`/effectifs/attendance/${v.id}/${v.action}`, { comment: v.comment }), onSuccess: invalidate });
  const rows = list.data ?? [];
  const spec = () => {
    const sum = Object.fromEntries(KEYS.map((k) => [k, rows.reduce((n, a) => n + a[k], 0)]));
    return {
      title: "État des effectifs", subtitle: `${range.from ? fmtDate(range.from) : "…"} – ${range.to ? fmtDate(range.to) : "…"}${type ? ` · ${type}` : ""}`,
      columns: [{ header: "Date", key: "date" }, { header: "Culte", key: "type" }, ...KEYS.map((k) => ({ header: SHORT[k], key: k, align: "right" as const })), { header: "Total", key: "total", align: "right" as const }, { header: "Statut", key: "status" }],
      rows: rows.map((a) => ({ date: fmtDate(a.serviceDate), type: a.serviceType, ...Object.fromEntries(KEYS.map((k) => [k, a[k]])), total: total(a), status: a.status })),
      totals: { date: "Total", ...sum, total: total(sum as any) },
    };
  };
  const btn = (a: Att, action: string, label: string) => <ActionButton size="sm" icon={Check} pending={act.isPending && act.variables?.id === a.id && act.variables?.action === action} onClick={() => act.mutate({ id: a.id, action })}>{label}</ActionButton>;
  const rej = (a: Att) => <ReasonButton danger icon={X} label="Rejeter" onConfirm={(comment) => act.mutate({ id: a.id, action: "reject", comment })} />;

  return (
    <Card title="Historique des effectifs" actions={<span className="flex flex-wrap items-center gap-2"><ValidationFlowButton counts={countByStatus(list.data)} /><ExportButtons spec={spec} /></span>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} className="w-auto" />
        <OptionSelect className="w-auto min-w-44" size="sm" aria-label="Culte" value={type} onValueChange={setType} placeholder="Tous les cultes" options={[{ value: "", label: "Tous les cultes" }, ...CULTE_TYPES.map((t) => ({ value: t, label: t }))]} />
      </div>
      <ErrorNote error={act.error} />
      <DataTable<Att> rows={rows} loading={list.isLoading} emptyIcon={Users} empty="Aucun effectif enregistré" pageSize={25} columns={[
        { header: "Date", cell: (a) => fmtDate(a.serviceDate), sort: (a) => a.serviceDate }, { header: "Culte", cell: (a) => a.serviceType, sort: (a) => a.serviceType },
        ...KEYS.map((k) => ({ header: SHORT[k], align: "right" as const, cell: (a: Att) => a[k] })),
        { header: "Total", align: "right", cell: (a) => <b>{total(a)}</b>, sort: total }, { header: "Statut", cell: (a) => <StatusBadge status={a.status} /> },
        { header: "", cell: (a) => {
          const mine = a.enteredBy === s.me.user.id;
          return (
            <span className="actions">
              {canEnter && mine && (a.status === "brouillon" || a.status === "rejetee") && <ActionButton size="sm" icon={Send} pending={act.isPending && act.variables?.id === a.id && act.variables?.action === "submit"} onClick={() => act.mutate({ id: a.id, action: "submit" })}>Soumettre</ActionButton>}
              {!mine && a.status === "soumise" && s.can("transaction.validate1") && <>{btn(a, "validate1", "Valider")}{rej(a)}</>}
              {!mine && a.status === "validee1" && s.can("transaction.validate2") && <>{btn(a, "validate2", "Valider")}{rej(a)}</>}
            </span>);
        } },
      ]} />
    </Card>
  );
}

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { Card, DataTable, ErrorNote, Field, ReasonButton, StatusBadge, PageHeader } from "../../components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

interface Att { id: string; serviceDate: string; serviceType: string; hommes: number; femmes: number; jeunes: number; enfants: number; visiteurs: number; status: any; enteredBy: string }
const GROUPS = ["hommes", "femmes", "jeunes", "enfants", "visiteurs"] as const;

export function EffectifsPage() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  const list = useQuery({ queryKey: useScopedKey("attendance"), queryFn: () => api.get<Att[]>("/engagements/attendance") });
  const [f, setF] = useState({ serviceDate: today(), serviceType: "Culte du dimanche", hommes: 0, femmes: 0, jeunes: 0, enfants: 0, visiteurs: 0 });
  const add = useMutation({ mutationFn: () => api.post("/engagements/attendance", f), onSuccess: () => { setF({ ...f, hommes: 0, femmes: 0, jeunes: 0, enfants: 0, visiteurs: 0 }); invalidate(); } });
  const act = useMutation({ mutationFn: (v: { id: string; action: string; comment?: string }) => api.post(`/engagements/attendance/${v.id}/${v.action}`, { comment: v.comment }), onSuccess: invalidate });
  const total = (a: Att | typeof f) => GROUPS.reduce((n, g) => n + a[g], 0);

  return (
    <>
      <PageHeader title="Effectifs" />
      {canEnter && (
        <Card title="Nouveau comptage">
          <div className="form-grid">
            <Field label="Date"><Input type="date" value={f.serviceDate} onChange={(e) => setF({ ...f, serviceDate: e.target.value })} /></Field>
            <Field label="Culte"><Input value={f.serviceType} onChange={(e) => setF({ ...f, serviceType: e.target.value })} /></Field>
            {GROUPS.map((g) => <Field key={g} label={g[0]!.toUpperCase() + g.slice(1)}><Input type="number" min={0} value={f[g]} onChange={(e) => setF({ ...f, [g]: Math.max(0, Number(e.target.value) || 0) })} /></Field>)}
            <Button size="sm" disabled={add.isPending} onClick={() => add.mutate()}>Ajouter ({total(f)} présents)</Button>
          </div>
          <ErrorNote error={add.error} />
        </Card>
      )}
      <Card title="Comptages">
        <ErrorNote error={act.error} />
        <DataTable<Att> rows={list.data ?? []} columns={[
          { header: "Date", cell: (a) => fmtDate(a.serviceDate) }, { header: "Culte", cell: (a) => a.serviceType },
          ...GROUPS.map((g) => ({ header: g, align: "right" as const, cell: (a: Att) => a[g] })),
          { header: "Total", align: "right", cell: (a) => total(a) }, { header: "Statut", cell: (a) => <StatusBadge status={a.status} /> },
          { header: "", cell: (a) => {
            const mine = a.enteredBy === s.me.user.id;
            return (
              <span className="actions">
                {canEnter && mine && (a.status === "brouillon" || a.status === "rejetee") && <Button size="sm" onClick={() => act.mutate({ id: a.id, action: "submit" })}>Soumettre</Button>}
                {!mine && a.status === "soumise" && s.can("transaction.validate1") && <><Button size="sm" onClick={() => act.mutate({ id: a.id, action: "validate1" })}>Valider</Button><ReasonButton danger label="Rejeter" onConfirm={(comment) => act.mutate({ id: a.id, action: "reject", comment })} /></>}
                {!mine && a.status === "validee1" && s.can("transaction.validate2") && <><Button size="sm" onClick={() => act.mutate({ id: a.id, action: "validate2" })}>Valider</Button><ReasonButton danger label="Rejeter" onConfirm={(comment) => act.mutate({ id: a.id, action: "reject", comment })} /></>}
              </span>);
          } },
        ]} />
      </Card>
    </>
  );
}

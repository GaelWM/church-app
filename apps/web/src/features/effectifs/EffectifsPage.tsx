import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader, ReasonButton, StatusBadge } from "@/components/common";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";

interface Att { id: string; serviceDate: string; serviceType: string; hommes: number; femmes: number; jeunes: number; enfants: number; visiteurs: number; status: any; enteredBy: string }
const GROUPS = ["hommes", "femmes", "jeunes", "enfants", "visiteurs"] as const;
const count = z.coerce.number({ message: "Nombre requis" }).int("Nombre entier").min(0, "Minimum 0");
const schema = z.object({ serviceDate: z.string().min(1, "Date requise"), serviceType: z.string().min(1, "Culte requis"), hommes: count, femmes: count, jeunes: count, enfants: count, visiteurs: count });
type Values = z.input<typeof schema>;

export function EffectifsPage() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canEnter = s.can("transaction.create") && !s.consolidated;
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: useScopedKey("attendance"), queryFn: () => api.get<Att[]>("/engagements/attendance") });
  const act = useMutation({ mutationFn: (v: { id: string; action: string; comment?: string }) => api.post(`/engagements/attendance/${v.id}/${v.action}`, { comment: v.comment }), onSuccess: invalidate });
  const total = (a: Att) => GROUPS.reduce((n, g) => n + a[g], 0);

  return (
    <>
      <PageHeader title="Effectifs">{canEnter && <Button onClick={() => setOpen(true)}><Plus /> Nouveau comptage</Button>}</PageHeader>
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
      <ModalForm open={open} onOpenChange={setOpen} title="Nouveau comptage" description="Effectifs présents au culte.">
        <AttendanceForm onClose={() => setOpen(false)} />
      </ModalForm>
    </>
  );
}

function AttendanceForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema), defaultValues: { serviceDate: today(), serviceType: "Culte du dimanche", hommes: 0, femmes: 0, jeunes: 0, enfants: 0, visiteurs: 0 },
  });
  const total = GROUPS.reduce((n, g) => n + (Number(watch(g)) || 0), 0);
  const add = useMutation({ mutationFn: (v: z.output<typeof schema>) => api.post("/engagements/attendance", v), onSuccess: () => { invalidate(); onClose(); } });
  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Date" error={errors.serviceDate?.message}><Input type="date" {...register("serviceDate")} /></Field>
        <Field label="Culte" error={errors.serviceType?.message}><Input {...register("serviceType")} /></Field>
        {GROUPS.map((g) => <Field key={g} label={g[0]!.toUpperCase() + g.slice(1)} error={errors[g]?.message}><Input type="number" min={0} {...register(g)} /></Field>)}
        <p className="muted self-end pb-2">Total : <b>{total}</b> présents</p>
      </FormGrid>
      <div className="mt-3"><ErrorNote error={add.error} /></div>
      <FormFooter pending={add.isPending} onCancel={onClose} />
    </form>
  );
}

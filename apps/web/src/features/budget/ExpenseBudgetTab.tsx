import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { BUDGET_PERIOD_LABELS } from "@church/shared";
import { Button } from "@/components/ui/button";
import { ActionButton, Card, DataTable, ErrorNote, ExportButtons, ModalForm, Money } from "@/components/common";
import { useApi } from "../../core/api";
import { money } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { ExpenseLine } from "./types";
import { ExpenseLineForm } from "./ExpenseLineForm";

function periodLabel(l: ExpenseLine) {
  const base = BUDGET_PERIOD_LABELS[l.period];
  if (l.period === "trimestriel") return `${base} (T${l.periodIndex})`;
  if (l.period === "mensuel") return `${base} (${String(l.periodIndex).padStart(2, "0")})`;
  return base;
}
const pctLabel = (bp: number | null) => (bp === null ? "—" : `${(bp / 100).toFixed(1)}%`);

export function ExpenseBudgetTab({ year }: { year: number }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canManage = s.can("budget.manage") && !s.consolidated;
  const rows = useQuery({ queryKey: useScopedKey("budget-expenses", year), queryFn: () => api.get<ExpenseLine[]>("/budget/expenses", { year: String(year) }) });
  const [dialog, setDialog] = useState<{ editing: ExpenseLine | null } | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.del(`/budget/expenses/${id}`), onSuccess: invalidate });

  const exportSpec = () => ({
    title: `Budget des dépenses ${year}`,
    columns: [
      { header: "Catégorie", key: "cat" }, { header: "Groupe", key: "grp" }, { header: "Période", key: "per" }, { header: "Devise", key: "cur" },
      { header: "Prévu", key: "planned", align: "right" as const }, { header: "Réalisé", key: "realized", align: "right" as const },
      { header: "Écart", key: "variance", align: "right" as const }, { header: "%", key: "pct", align: "right" as const }, { header: "Observation", key: "obs" },
    ],
    rows: (rows.data ?? []).map((l) => ({
      cat: l.categoryName, grp: l.categoryGroup ?? "", per: periodLabel(l), cur: l.currency,
      planned: money(l.amountMinor, l.currency), realized: money(l.realizedMinor, l.currency), variance: money(l.varianceMinor, l.currency),
      pct: pctLabel(l.consumptionBp), obs: l.observation ?? "",
    })),
  });

  return (
    <>
      <Card
        title="Budget des dépenses"
        actions={<span className="flex items-center gap-2"><ExportButtons spec={exportSpec} />{canManage && <Button size="sm" onClick={() => setDialog({ editing: null })}><Plus /> Ligne de budget</Button>}</span>}
      >
        <ErrorNote error={del.error} />
        <DataTable<ExpenseLine>
          rows={rows.data ?? []} loading={rows.isLoading} empty="Aucune ligne de budget pour cette année"
          columns={[
            { header: "Catégorie", cell: (l) => <>{l.categoryGroup ? `${l.categoryGroup} · ` : ""}{l.categoryName}</>, sort: (l) => `${l.categoryGroup ?? ""}|${l.categoryName}` },
            { header: "Période", cell: periodLabel },
            { header: "Devise", cell: (l) => l.currency },
            { header: "Prévu", align: "right", cell: (l) => <Money value={l.amountMinor} currency={l.currency} />, sort: (l) => l.amountMinor },
            { header: "Réalisé", align: "right", cell: (l) => <Money value={l.realizedMinor} currency={l.currency} />, sort: (l) => l.realizedMinor },
            { header: "Écart", align: "right", cell: (l) => <Money value={l.varianceMinor} currency={l.currency} />, sort: (l) => l.varianceMinor },
            { header: "%", align: "right", cell: (l) => <span className={l.overBudget ? "font-medium text-destructive" : undefined}>{pctLabel(l.consumptionBp)}</span>, sort: (l) => l.consumptionBp },
            { header: "Observation", cell: (l) => l.observation ?? "" },
            {
              header: "", cell: (l) => canManage && (
                <span className="actions">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ editing: l })}><Pencil />Modifier</Button>
                  <ActionButton size="sm" variant="destructive" icon={Trash2} pending={del.isPending && del.variables === l.id} onClick={() => del.mutate(l.id)}>Supprimer</ActionButton>
                </span>
              ),
            },
          ]}
        />
      </Card>
      <ModalForm open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} title={dialog?.editing ? "Modifier la ligne de budget" : "Nouvelle ligne de budget"}>
        {dialog && <ExpenseLineForm year={year} editing={dialog.editing} onClose={() => setDialog(null)} />}
      </ModalForm>
    </>
  );
}

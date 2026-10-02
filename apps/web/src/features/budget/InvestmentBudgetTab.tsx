import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { INVESTMENT_TYPE_LABELS } from "@church/shared";
import { Button } from "@/components/ui/button";
import { ActionButton, Card, DataTable, ErrorNote, ExportButtons, ModalForm, Money } from "@/components/common";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Investment, InvestmentTransaction } from "./types";
import { InvestmentForm } from "./InvestmentForm";

export function InvestmentBudgetTab({ year }: { year: number }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const canManage = s.can("budget.manage") && !s.consolidated;
  const rows = useQuery({ queryKey: useScopedKey("budget-investments", year), queryFn: () => api.get<Investment[]>("/budget/investments", { year: String(year) }) });
  const [dialog, setDialog] = useState<{ editing: Investment | null } | null>(null);
  const [drill, setDrill] = useState<Investment | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.del(`/budget/investments/${id}`), onSuccess: invalidate });

  const exportSpec = () => ({
    title: `Budget d'investissement ${year}`,
    columns: [
      { header: "Projet", key: "name" }, { header: "Type", key: "type" }, { header: "Devise", key: "cur" },
      { header: "Prévu", key: "planned", align: "right" as const }, { header: "Réalisé", key: "realized", align: "right" as const }, { header: "Solde", key: "balance", align: "right" as const },
    ],
    rows: (rows.data ?? []).map((i) => ({
      name: i.name, type: INVESTMENT_TYPE_LABELS[i.type], cur: i.currency,
      planned: money(i.amountMinor, i.currency), realized: money(i.realizedMinor, i.currency), balance: money(i.balanceMinor, i.currency),
    })),
  });

  return (
    <>
      <Card
        title="Budget d'investissement"
        actions={<span className="flex items-center gap-2"><ExportButtons spec={exportSpec} />{canManage && <Button size="sm" onClick={() => setDialog({ editing: null })}><Plus /> Projet</Button>}</span>}
      >
        <ErrorNote error={del.error} />
        <DataTable<Investment>
          rows={rows.data ?? []} loading={rows.isLoading} empty="Aucun projet d'investissement pour cette année"
          columns={[
            { header: "Projet", cell: (i) => i.name, sort: (i) => i.name },
            { header: "Type", cell: (i) => INVESTMENT_TYPE_LABELS[i.type] },
            { header: "Devise", cell: (i) => i.currency },
            { header: "Prévu", align: "right", cell: (i) => <Money value={i.amountMinor} currency={i.currency} />, sort: (i) => i.amountMinor },
            { header: "Réalisé", align: "right", cell: (i) => <Money value={i.realizedMinor} currency={i.currency} />, sort: (i) => i.realizedMinor },
            { header: "Solde", align: "right", cell: (i) => <span className={BigInt(i.balanceMinor) < 0n ? "font-medium text-destructive" : undefined}><Money value={i.balanceMinor} currency={i.currency} /></span>, sort: (i) => i.balanceMinor },
            {
              header: "", cell: (i) => (
                <span className="actions">
                  <Button size="sm" variant="outline" onClick={() => setDrill(i)}><Receipt />Voir les dépenses</Button>
                  {canManage && <Button size="sm" variant="outline" onClick={() => setDialog({ editing: i })}><Pencil />Modifier</Button>}
                  {canManage && <ActionButton size="sm" variant="destructive" icon={Trash2} pending={del.isPending && del.variables === i.id} onClick={() => del.mutate(i.id)}>Supprimer</ActionButton>}
                </span>
              ),
            },
          ]}
        />
      </Card>
      <ModalForm open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} title={dialog?.editing ? "Modifier le projet" : "Nouveau projet d'investissement"}>
        {dialog && <InvestmentForm year={year} editing={dialog.editing} onClose={() => setDialog(null)} />}
      </ModalForm>
      <ModalForm open={!!drill} onOpenChange={(o) => !o && setDrill(null)} title={drill ? `Dépenses liées — ${drill.name}` : ""} className="sm:max-w-2xl">
        {drill && <InvestmentTransactionsDialog investment={drill} />}
      </ModalForm>
    </>
  );
}

function InvestmentTransactionsDialog({ investment }: { investment: Investment }) {
  const api = useApi();
  const txs = useQuery({
    queryKey: useScopedKey("budget-investment-tx", investment.id),
    queryFn: () => api.get<InvestmentTransaction[]>(`/budget/investments/${investment.id}/transactions`),
  });
  return (
    <DataTable<InvestmentTransaction>
      rows={txs.data ?? []} loading={txs.isLoading} empty="Aucune dépense liée à ce projet"
      columns={[
        { header: "Date", cell: (t) => fmtDate(t.date) },
        { header: "Réf.", cell: (t) => t.reference },
        { header: "Description", cell: (t) => t.description ?? "" },
        { header: "Montant", align: "right", cell: (t) => <Money value={t.amountMinor} currency={t.currency} /> },
      ]}
    />
  );
}

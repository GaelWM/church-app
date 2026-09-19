import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Currency } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";
import { Card, DataTable, ErrorNote, StatusBadge, PageHeader, ReasonDialog } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

/** "À valider" inbox: Trésorier sees Soumise (step 1), Pasteur sees Validée 1 (step 2). Batch actions. */
export function ValidationPage() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const step1 = s.can("transaction.validate1");
  const step2 = s.can("transaction.validate2");
  const status = [step1 && "soumise", step2 && "validee1"].filter(Boolean).join(",");
  const accounts = useAccounts();
  const categories = useCategories();
  const [selected, setSelected] = useState(new Set<string>());
  const [rejecting, setRejecting] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; ok: boolean; error?: string }>>([]);

  const list = useQuery({ queryKey: useScopedKey("inbox", status), queryFn: () => api.get<Tx[]>("/transactions", { status }), enabled: !!status });
  const batch = useMutation({
    mutationFn: ({ action, comment }: { action: string; comment?: string }) => api.post<{ results: typeof results }>(`/transactions/batch/${action}`, { ids: [...selected], comment }),
    onSuccess: (r) => { setResults(r.results); setSelected(new Set()); invalidate(); },
  });

  // Nobody validates what they entered: those rows are shown but cannot be selected.
  const rows = (list.data ?? []).filter((t) => t.enteredBy !== s.me.user.id);
  const failed = results.filter((r) => !r.ok);
  const stepFor = (t: Tx) => (t.status === "soumise" ? "validate1" : "validate2");

  return (
    <>
      <PageHeader title="À valider" />
      <Card title={`${rows.length} écriture(s) en attente`} actions={
        <span className="inline-flex items-center gap-1.5">
          <Button variant="destructive" disabled={!selected.size || batch.isPending} onClick={() => setRejecting(true)}>Rejeter ({selected.size})</Button>
          <Button disabled={!selected.size || batch.isPending} onClick={() => {
            const chosen = rows.filter((t) => selected.has(t.id));
            // A mixed selection is split by state so each row gets the right step.
            new Set(chosen.map(stepFor)).forEach((action) => batch.mutate({ action }));
          }}>Valider ({selected.size})</Button>
        </span>
      }>
        <ErrorNote error={batch.error} />
        {failed.length > 0 && <p className="text-sm text-destructive">{failed.length} échec(s) : {[...new Set(failed.map((f) => f.error))].join(" ; ")}</p>}
        <DataTable<Tx>
          rows={rows}
          select={{ selected, onChange: setSelected }}
          columns={[
            { header: "Réf.", cell: (t) => t.reference },
            { header: "Date", cell: (t) => fmtDate(t.date) },
            { header: "Type", cell: (t) => (t.direction === "in" ? "Entrée" : "Sortie") + " · " + (categories.data?.find((c) => c.id === t.categoryId)?.name ?? t.kind) },
            { header: "Compte", cell: (t) => accounts.data?.find((a) => a.id === t.accountId)?.name ?? "" },
            { header: "Montant", align: "right", cell: (t) => money(t.amountMinor, t.currency as Currency) },
            { header: "Statut", cell: (t) => <StatusBadge status={t.status} /> },
          ]}
        />
      </Card>
      <ReasonDialog open={rejecting} onOpenChange={setRejecting} title={`Rejeter ${selected.size} écriture(s)`} label="Motif du rejet (envoyé au caissier)" confirmLabel="Rejeter" destructive
        onConfirm={(comment) => batch.mutate({ action: "reject", comment })} />
    </>
  );
}

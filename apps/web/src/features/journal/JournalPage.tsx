import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Printer, Search } from "lucide-react";
import { STATUS_LABELS, type TxStatus } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate } from "../../core/format";
import { useAccounts, useCategories, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { JournalResponse, JournalRow } from "../../core/types";
import { exportTable } from "../../lib/export-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DateRangePicker, OptionSelect, dateLimits } from "../../components/form-controls";
import { DataTable, Field, Money, StatusBadge, PageHeader } from "../../components/common";

const EMPTY = { from: "", to: "", accountId: "", categoryId: "", currency: "", enteredBy: "", validatorId: "", status: "", q: "" };
const STATUSES: TxStatus[] = ["brouillon", "soumise", "validee1", "validee", "rejetee", "annulee"];

/** Exact bigint -> "1 234,56" (no float, no currency). Used by Excel / PDF / print. */
export function plainAmount(minor: string | bigint): string {
  const v = BigInt(minor), abs = v < 0n ? -v : v;
  const s = abs.toString().padStart(3, "0");
  const int = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${v < 0n ? "-" : ""}${int},${s.slice(-2)}`;
}
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
const stamp = (name?: string | null, at?: string | null) => (name ? `${name}${at ? ` (${new Date(at).toLocaleString("fr-FR")})` : ""}` : "");
const validators = (r: JournalRow) => [r.validator1Name, r.validator2Name].filter(Boolean).join(" / ");
const label = (r: JournalRow) => [r.description, r.beneficiary && `→ ${r.beneficiary}`].filter(Boolean).join(" ");

/**
 * Journal des transactions: every line, chronological, running validated balance per account,
 * opening / closing balance and period totals per currency. Filters and search run on the server.
 * `rowActions` renders inside the expanded row (e.g. the "Demander une modification" button).
 */
export function JournalPage({ rowActions }: { rowActions?: (tx: JournalRow) => ReactNode }) {
  const api = useApi();
  const s = useSession();
  const accounts = useAccounts();
  const categories = useCategories();
  const [f, setF] = useState(EMPTY);
  const [qText, setQText] = useState("");
  useEffect(() => { const t = setTimeout(() => setF((p) => (p.q === qText ? p : { ...p, q: qText })), 300); return () => clearTimeout(t); }, [qText]);
  const people = useQuery({ queryKey: useScopedKey("tx-people"), queryFn: () => api.get<{ id: string; fullName: string; initiator: boolean; validator: boolean }[]>("/transactions/people") });
  const res = useQuery({
    queryKey: useScopedKey("journal", f),
    queryFn: () => api.get<JournalResponse>("/transactions/journal", Object.fromEntries(Object.entries(f).filter(([, v]) => v))),
  });
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["tx", open], queryFn: () => api.get<any>(`/transactions/${open}`), enabled: !!open });
  const data = res.data?.rows ?? [];
  const summary = res.data?.summary ?? [];
  const opened = data.find((r) => r.id === open);

  // Direct print: render every row (no pagination), then window.print() with the @media print layout.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  const title = `Journal — ${s.parish?.name ?? "Consolidé"}`;
  const subtitle = [
    f.from || f.to ? `Période ${f.from ? fmtDate(f.from) : "…"} – ${f.to ? fmtDate(f.to) : "…"}` : "Toutes périodes",
    f.currency && `Devise ${f.currency}`, f.status && `Statut ${STATUS_LABELS[f.status as TxStatus]}`, f.q && `Recherche « ${f.q} »`,
    ...summary.map((x) => `${x.currency} : ouverture ${plainAmount(x.opening)}, entrées ${plainAmount(x.in)}, sorties ${plainAmount(x.out)}, clôture ${plainAmount(x.closing)}`),
  ].filter(Boolean).join(" · ");
  const exportSpec = () => ({
    title, subtitle,
    columns: [
      ["date", "Date"], ["heure", "Heure"], ["ref", "Référence"], ["piece", "N° pièce"], ["compte", "Compte"], ["cat", "Catégorie"],
      ["in", "Entrée", "right"], ["out", "Sortie", "right"], ["solde", "Solde", "right"], ["lib", "Libellé"], ["montant", "Montant", "right"], ["devise", "Devise"],
      ["init", "Initiateur"], ["val", "Validateur"], ["statut", "Statut"],
    ].map(([key, header, align]) => ({ key: key!, header: header!, align: align as "right" | undefined })),
    rows: data.map((r) => ({
      date: fmtDate(r.date), heure: time(r.createdAt), ref: r.reference, piece: r.documentNumber, compte: r.accountName, cat: [r.categoryName, r.subCategory].filter(Boolean).join(" / "),
      in: r.direction === "in" ? plainAmount(r.amountMinor) : "", out: r.direction === "out" ? plainAmount(r.amountMinor) : "",
      solde: plainAmount(r.runningBalance), lib: label(r), montant: (r.direction === "out" ? "-" : "") + plainAmount(r.amountMinor), devise: r.currency,
      init: r.enteredByName, val: validators(r), statut: STATUS_LABELS[r.status],
    })),
  });

  const filtered = Object.entries(f).some(([, v]) => v);
  const opt = (rows: { value: string; label: string }[], all: string) => [{ value: "", label: all }, ...rows];
  const person = (k: "initiator" | "validator") => (people.data ?? []).filter((p) => p[k]).map((p) => ({ value: p.id, label: p.fullName }));

  return (
    <div className="journal">
      <PageHeader title="Journal des transactions">
        {s.can("report.export") && (
          <span className="actions no-print">
            <Button size="sm" variant="outline" disabled={!data.length} onClick={() => exportTable("xlsx", exportSpec())}><FileSpreadsheet />Excel</Button>
            <Button size="sm" variant="outline" disabled={!data.length} onClick={() => exportTable("pdf", exportSpec())}><FileText />PDF</Button>
            <Button size="sm" variant="outline" disabled={!data.length} onClick={() => setPrinting(true)}><Printer />Imprimer</Button>
          </span>
        )}
      </PageHeader>
      <div className="print-only print-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <p>Imprimé le {new Date().toLocaleString("fr-FR")}</p>
      </div>

      <div className="no-print mb-5 flex flex-wrap items-end gap-x-3 gap-y-3 border-b pb-5">
        <Field label="Période"><DateRangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} max={dateLimits.past().max} /></Field>
        <Field label="Compte"><OptionSelect className="min-w-36" value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })} placeholder="Tous" options={opt((accounts.data ?? []).map((a) => ({ value: a.id, label: a.name })), "Tous")} /></Field>
        <Field label="Catégorie"><OptionSelect className="min-w-40" value={f.categoryId} onValueChange={(v) => setF({ ...f, categoryId: v })} placeholder="Toutes" options={opt((categories.data ?? []).map((c) => ({ value: c.id, label: c.name })), "Toutes")} /></Field>
        <Field label="Devise"><OptionSelect className="min-w-28" value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })} placeholder="Toutes" options={opt([{ value: "CDF", label: "CDF" }, { value: "USD", label: "USD" }], "Toutes")} /></Field>
        <Field label="Initiateur"><OptionSelect className="min-w-36" value={f.enteredBy} onValueChange={(v) => setF({ ...f, enteredBy: v })} placeholder="Tous" options={opt(person("initiator"), "Tous")} /></Field>
        <Field label="Validateur"><OptionSelect className="min-w-36" value={f.validatorId} onValueChange={(v) => setF({ ...f, validatorId: v })} placeholder="Tous" options={opt(person("validator"), "Tous")} /></Field>
        <Field label="Statut"><OptionSelect className="min-w-32" value={f.status} onValueChange={(v) => setF({ ...f, status: v })} placeholder="Tous" options={opt(STATUSES.map((x) => ({ value: x, label: STATUS_LABELS[x] })), "Tous")} /></Field>
        <Field label="Recherche">
          <span className="relative block"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input className="min-w-56 pl-8" placeholder="Référence, n° pièce, libellé" value={qText} onChange={(e) => setQText(e.target.value)} /></span>
        </Field>
        {filtered && <Button type="button" variant="ghost" size="sm" onClick={() => { setF(EMPTY); setQText(""); }}>Réinitialiser</Button>}
      </div>

      <div className="mb-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 journal-summary" aria-label="Totaux de la période">
        {res.isLoading ? <Skeleton className="h-16 w-full sm:col-span-4" /> : summary.map((x) => (
          <div key={x.currency} className="contents">
            <Stat title={`Solde d'ouverture ${x.currency}`}><Money value={x.opening} currency={x.currency} /></Stat>
            <Stat title="Entrées"><Money value={x.in} currency={x.currency} className="text-success" /></Stat>
            <Stat title="Sorties"><Money value={x.out} currency={x.currency} className="text-destructive" /></Stat>
            <Stat title={`Solde de clôture ${x.currency}`}><Money value={x.closing} currency={x.currency} className="font-semibold" /></Stat>
          </div>
        ))}
      </div>
      {res.data?.truncated && <p className="no-print mb-3 text-sm text-warning">Résultat tronqué : affinez les filtres pour voir toutes les lignes (les totaux ci-dessus restent complets).</p>}

      <div>
        <DataTable
          rows={data} loading={res.isLoading} pageSize={printing ? 100_000 : 25} empty="Aucune écriture pour ces filtres"
          columns={[
            { header: "Date", sort: (r) => r.date, cell: (r) => fmtDate(r.date) },
            { header: "Heure", cell: (r) => time(r.createdAt) },
            { header: "Réf.", sort: (r) => r.reference, cell: (r) => <a href="#" className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => { e.preventDefault(); setOpen(open === r.id ? null : r.id); }}>{r.reference}</a> },
            { header: "N° pièce", cell: (r) => r.documentNumber ?? "" },
            { header: "Compte", sort: (r) => r.accountName, cell: (r) => r.accountName },
            { header: "Catégorie", sort: (r) => r.categoryName, cell: (r) => <>{r.categoryName}{r.subCategory && <div className="text-xs text-muted-foreground">{r.subCategory}</div>}</> },
            { header: "Entrée", align: "right", cell: (r) => (r.direction === "in" ? <Money value={r.amountMinor} currency={r.currency} /> : "") },
            { header: "Sortie", align: "right", cell: (r) => (r.direction === "out" ? <Money value={r.amountMinor} currency={r.currency} /> : "") },
            { header: "Solde", align: "right", cell: (r) => <Money value={r.runningBalance} currency={r.currency} /> },
            { header: "Libellé", cell: (r) => label(r) },
            { header: "Montant", align: "right", sort: (r) => Number(r.amountMinor), cell: (r) => <span className={r.status === "annulee" ? "line-through" : ""}>{r.direction === "out" ? "-" : ""}{plainAmount(r.amountMinor)}</span> },
            { header: "Devise", cell: (r) => r.currency },
            { header: "Initiateur", cell: (r) => r.enteredByName ?? "" },
            { header: "Validateur", cell: (r) => validators(r) },
            { header: "Statut", cell: (r) => (r.status === "annulee" ? <span className="text-xs font-medium text-muted-foreground">Annulée</span> : <StatusBadge status={r.status} />) },
          ]}
        />
        {open && (
          <div className="no-print mt-3 rounded-lg border p-3">
            <h3 className="mb-2 font-medium">Historique de validation{detail.data ? ` — ${detail.data.reference}` : ""}</h3>
            {opened && (opened.validator1Name || opened.validator2Name) && (
              <p className="mb-2 text-sm text-muted-foreground">
                {opened.validator1Name && <>Validateur N1 : {stamp(opened.validator1Name, opened.validator1At)}. </>}
                {opened.validator2Name && <>Validateur N2 : {stamp(opened.validator2Name, opened.validator2At)}.</>}
              </p>
            )}
            {detail.isLoading ? (
              <div role="status" aria-label="Chargement" className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-3/5" /></div>
            ) : (
              <ol className="space-y-2">
                {detail.data?.events.map((e: any) => (
                  <li key={e.id} className="flex items-start gap-2 text-sm">
                    <div>
                      <b>{STATUS_LABELS[e.toStatus as TxStatus] ?? e.toStatus}</b> — {e.actorName}
                      <span className="text-muted-foreground"> · {new Date(e.at).toLocaleString("fr-FR")}</span>
                      {e.comment && <div className="text-muted-foreground">« {e.comment} »</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {/* Row actions hook: the lead mounts <RequestChangeButton tx={...} /> here through the `rowActions` prop. */}
            {opened && rowActions && <div className="mt-3 flex flex-wrap gap-2">{rowActions(opened)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ title, children }: { title: string; children: ReactNode }) {
  return <div className="min-w-0"><div className="label-caps">{title}</div><div className="stat mt-1 text-lg sm:text-2xl">{children}</div></div>;
}


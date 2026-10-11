import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownUp, Boxes, Plus, Printer, QrCode, Search, X } from "lucide-react";
import {
  accountDisplay, ASSET_ACCOUNT_CODES, ASSET_CURRENCIES, ASSET_ETATS, ASSET_ETAT_LABELS, DEPRECIATION_METHODS, DEPRECIATION_METHOD_LABELS,
  PERSISTED_ASSET_STATUTS, ASSET_STATUT_LABELS, subaccountDisplay, subaccountsOf,
} from "@church/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, DataTable, ErrorNote, ExportButtons, Field, ModalForm, type Column } from "@/components/common";
import { DateRangePicker, OptionSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { fmtDate, money } from "../../core/format";
import { useSession } from "../../core/session";
import { AssetStatutBadge, EtatBadge } from "./badges";
import { AssetForm } from "./AssetForm";
import { LabelPrintDialog } from "./labels/LabelPrintDialog";
import { filterParams, PAGE_SIZE, useAssetPage, useAssetRefs } from "./queries";
import { EMPTY_FILTERS, type Asset, type AssetFilters, type AssetPage } from "./types";

const ALL = (label: string) => ({ value: "", label });
const SORTS = [
  { value: "created_at", label: "Plus récentes" }, { value: "code", label: "Code" }, { value: "acquisition_date", label: "Date d'acquisition" },
  { value: "cost_minor", label: "Coût d'acquisition" }, { value: "description", label: "Description" },
];
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 82 }, (_, i) => String(THIS_YEAR + 1 - i)); // the 80-year window the API accepts
const pct = (r: number | null) => (r == null ? "—" : `${String(r).replace(".", ",")} %`);

/** The same cells on screen and in the exports, so the two can never disagree. */
const exportRow = (a: Asset) => ({
  code: a.code, account: accountDisplay(a.accountCode), subaccount: subaccountDisplay(a.subaccountCode), description: a.description,
  invoice: a.invoiceNumber ?? "", supplier: a.supplierName ?? "", location: a.locationName, acquisition: fmtDate(a.acquisitionDate),
  inService: fmtDate(a.inServiceDate), currency: a.currency, pa: money(a.paMinor, a.currency), faa: money(a.faaMinor, a.currency),
  cost: money(a.costMinor, a.currency), mode: DEPRECIATION_METHOD_LABELS[a.depreciationMethod], duration: a.usefulLifeYears ? `${a.usefulLifeYears} ans` : "",
  rate: a.rate == null ? "" : pct(a.rate), exercise: money(a.exerciseMinor, a.currency), accumulated: money(a.accumulatedMinor, a.currency),
  vnc: money(a.vncMinor, a.currency), etat: ASSET_ETAT_LABELS[a.etat], statut: ASSET_STATUT_LABELS[a.displayStatut],
});
const EXPORT_COLUMNS = [
  ["code", "Code"], ["account", "Type de compte"], ["subaccount", "Sous-compte"], ["description", "Description"], ["invoice", "N° facture"],
  ["supplier", "Fournisseur"], ["location", "Localisation"], ["acquisition", "Date d'acquisition"], ["inService", "Date de mise en service"],
  ["currency", "Devise"], ["pa", "PA"], ["faa", "FAA"], ["cost", "Coût d'acquisition"], ["mode", "Mode d'amortissement"], ["duration", "Durée"],
  ["rate", "Taux"], ["exercise", "Amort. de l'exercice"], ["accumulated", "Amort. cumulé"], ["vnc", "VNC"], ["etat", "État"], ["statut", "Statut"],
] as const;
const RIGHT = new Set(["pa", "faa", "cost", "exercise", "accumulated", "vnc", "rate"]);

/** Registre des immobilisations (§16) with the search and filters of §17. Search and filters run on the server. */
export function AssetRegistreTab() {
  const s = useSession();
  const api = useApi();
  const refs = useAssetRefs();
  const canWrite = s.can("asset.manage") && !s.consolidated;
  const [f, setF] = useState<AssetFilters>(EMPTY_FILTERS);
  const [qText, setQText] = useState("");
  const [creating, setCreating] = useState(false);
  // Selection for batch printing survives paging, so keep the rows themselves (the label needs their data).
  const [picked, setPicked] = useState<Map<string, Asset>>(new Map());
  const [printing, setPrinting] = useState<"etiquette" | "code" | null>(null);
  // Typing in the search box waits 300 ms before it hits the server.
  useEffect(() => { const t = setTimeout(() => setF((p) => (p.q === qText ? p : { ...p, q: qText, page: 1 })), 300); return () => clearTimeout(t); }, [qText]);
  const set = (patch: Partial<AssetFilters>) => setF((p) => ({ ...p, ...patch, page: patch.page ?? 1 }));
  const list = useAssetPage(f);
  const data = list.data;
  const filtered = !!(f.q || f.account || f.subaccount || f.year || f.locationId || f.supplierId || f.currency || f.mode || f.etat || f.statut || f.from || f.to);

  const onPick = (ids: Set<string>) => setPicked((prev) => {
    const next = new Map<string, Asset>();
    for (const id of ids) { const row = prev.get(id) ?? data?.rows.find((r) => r.id === id); if (row) next.set(id, row); }
    return next;
  });

  const columns = useMemo<Column<Asset>[]>(() => [
    { header: "Code", cell: (a) => <Link to={`/immobilisations/${a.id}`} className="font-mono font-medium underline-offset-2 hover:underline">{a.code}</Link> },
    { header: "Type de compte", cell: (a) => accountDisplay(a.accountCode) },
    { header: "Sous-compte", cell: (a) => subaccountDisplay(a.subaccountCode) },
    { header: "Description", cell: (a) => a.description },
    { header: "N° facture", cell: (a) => a.invoiceNumber ?? "—" },
    { header: "Fournisseur", cell: (a) => a.supplierName ?? "—" },
    { header: "Localisation", cell: (a) => a.locationName },
    { header: "Acquisition", cell: (a) => fmtDate(a.acquisitionDate) },
    { header: "Mise en service", cell: (a) => fmtDate(a.inServiceDate) || "—" },
    { header: "Devise", cell: (a) => a.currency },
    { header: "PA", align: "right", cell: (a) => money(a.paMinor, a.currency) },
    { header: "FAA", align: "right", cell: (a) => money(a.faaMinor, a.currency) },
    { header: "Coût d'acquisition", align: "right", cell: (a) => money(a.costMinor, a.currency) },
    { header: "Mode", cell: (a) => DEPRECIATION_METHOD_LABELS[a.depreciationMethod] },
    { header: "Durée", cell: (a) => (a.usefulLifeYears ? `${a.usefulLifeYears} ans` : "—") },
    { header: "Taux", align: "right", cell: (a) => pct(a.rate) },
    { header: "Amort. exercice", align: "right", cell: (a) => money(a.exerciseMinor, a.currency) },
    { header: "Amort. cumulé", align: "right", cell: (a) => money(a.accumulatedMinor, a.currency) },
    { header: "VNC", align: "right", cell: (a) => money(a.vncMinor, a.currency) },
    { header: "État", cell: (a) => <EtatBadge etat={a.etat} /> },
    { header: "Statut", cell: (a) => (
      <span className="flex flex-col gap-0.5"><AssetStatutBadge statut={a.displayStatut} />{a.openRequest && <span className="text-xs text-warning-foreground">Demande en cours</span>}</span>
    ) },
  ], []);

  /** Every matching asset (all pages), formatted like the table. */
  const exportSpec = async () => {
    const rows: Asset[] = [];
    for (let page = 1; page <= 100; page++) {
      const p = await api.get<AssetPage>("/immobilisations", filterParams({ ...f, page }, { pageSize: "200" }));
      rows.push(...p.rows);
      if (rows.length >= p.total) break;
    }
    return {
      title: `Registre des immobilisations — ${s.parish?.name ?? "Consolidé"}`,
      subtitle: [filtered && "Résultats filtrés", `Situation au ${fmtDate(data?.asOf)}`, `${rows.length} immobilisation(s)`].filter(Boolean).join(" · "),
      columns: EXPORT_COLUMNS.map(([key, header]) => ({ header, key, align: RIGHT.has(key) ? ("right" as const) : undefined })),
      rows: rows.map(exportRow),
    };
  };

  const subOptions = f.account ? subaccountsOf(f.account) : [];
  return (
    <>
      <Card title="Registre des immobilisations" actions={<span className="flex flex-wrap items-center gap-2">
        {picked.size > 0 && !s.consolidated && (
          <>
            <Button size="sm" variant="outline" onClick={() => setPrinting("etiquette")}><QrCode />Étiquettes ({picked.size})</Button>
            <Button size="sm" variant="outline" onClick={() => setPrinting("code")}><Printer />Codes ({picked.size})</Button>
          </>
        )}
        <ExportButtons spec={exportSpec} />
        {canWrite && <Button size="sm" onClick={() => setCreating(true)}><Plus /> Immobilisation</Button>}
      </span>}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 max-w-sm flex-1">
            <Search className="absolute left-2 top-2 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Code, description, facture, fournisseur, compte, lieu, année…" aria-label="Rechercher" value={qText} onChange={(e) => setQText(e.target.value)} />
          </div>
          <Field label="Compte"><OptionSelect size="sm" className="w-auto min-w-44" value={f.account} onValueChange={(v) => set({ account: v, subaccount: "" })} options={[ALL("Tous les comptes"), ...ASSET_ACCOUNT_CODES.map((c) => ({ value: c, label: accountDisplay(c) }))]} /></Field>
          <Field label="Sous-compte"><OptionSelect size="sm" className="w-auto min-w-44" disabled={!f.account} value={f.subaccount} onValueChange={(v) => set({ subaccount: v })} options={[ALL("Tous"), ...subOptions.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }))]} /></Field>
          <Field label="Année"><OptionSelect size="sm" className="w-auto min-w-28" value={f.year} onValueChange={(v) => set({ year: v })} options={[ALL("Toutes"), ...YEARS.map((y) => ({ value: y, label: y }))]} /></Field>
          <Field label="Localisation"><OptionSelect size="sm" className="w-auto min-w-40" value={f.locationId} onValueChange={(v) => set({ locationId: v })} options={[ALL("Toutes"), ...(refs.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))]} /></Field>
          <Field label="Fournisseur"><OptionSelect size="sm" className="w-auto min-w-40" value={f.supplierId} onValueChange={(v) => set({ supplierId: v })} options={[ALL("Tous"), ...(refs.data?.suppliers ?? []).map((x) => ({ value: x.id, label: x.name }))]} /></Field>
          <Field label="Devise"><OptionSelect size="sm" className="w-auto min-w-24" value={f.currency} onValueChange={(v) => set({ currency: v })} options={[ALL("Toutes"), ...ASSET_CURRENCIES.map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label="Mode d'amortissement"><OptionSelect size="sm" className="w-auto min-w-36" value={f.mode} onValueChange={(v) => set({ mode: v })} options={[ALL("Tous"), ...DEPRECIATION_METHODS.map((m) => ({ value: m, label: DEPRECIATION_METHOD_LABELS[m] }))]} /></Field>
          <Field label="État"><OptionSelect size="sm" className="w-auto min-w-32" value={f.etat} onValueChange={(v) => set({ etat: v })} options={[ALL("Tous"), ...ASSET_ETATS.map((e) => ({ value: e, label: ASSET_ETAT_LABELS[e] }))]} /></Field>
          <Field label="Statut"><OptionSelect size="sm" className="w-auto min-w-40" value={f.statut} onValueChange={(v) => set({ statut: v })} options={[ALL("Tous"), ...PERSISTED_ASSET_STATUTS.map((x) => ({ value: x, label: ASSET_STATUT_LABELS[x] }))]} /></Field>
          <Field label="Date d'acquisition"><DateRangePicker from={f.from} to={f.to} onChange={(r) => set(r)} min={new Date(THIS_YEAR - 80, 0, 1)} max={new Date(THIS_YEAR + 1, 11, 31)} /></Field>
          <Field label="Trier par">
            <span className="flex gap-1">
              <OptionSelect size="sm" className="w-auto min-w-36" value={f.sort} onValueChange={(v) => set({ sort: v, page: 1 })} options={SORTS} />
              <Button type="button" size="icon-sm" variant="outline" aria-label={f.dir === "asc" ? "Ordre croissant" : "Ordre décroissant"} onClick={() => set({ dir: f.dir === "asc" ? "desc" : "asc" })}><ArrowDownUp /></Button>
            </span>
          </Field>
          {filtered && <Button type="button" size="sm" variant="ghost" onClick={() => { setQText(""); setF(EMPTY_FILTERS); }}><X />Effacer les filtres</Button>}
        </div>
        <ErrorNote error={list.error} />
        <DataTable<Asset>
          rows={data?.rows ?? []} columns={columns} loading={list.isLoading} emptyIcon={Boxes}
          select={{ selected: new Set(picked.keys()), onChange: onPick, selectable: (a) => a.statut === "actif" }}
          empty={filtered ? "Aucune immobilisation ne correspond à ces critères" : "Aucune immobilisation enregistrée"}
          serverPage={data ? { page: data.page, pageSize: PAGE_SIZE, total: data.total, onChange: (page) => set({ page }) } : undefined}
        />
        {data && data.total > 0 && <p className="text-xs text-muted-foreground">{data.total} immobilisation(s) · amortissements calculés au {fmtDate(data.asOf)}</p>}
      </Card>
      {printing && (
        <LabelPrintDialog open variant={printing} onOpenChange={(o) => { if (!o) setPrinting(null); }}
          items={[...picked.values()].map((a) => ({ id: a.id, code: a.code, description: a.description, locationName: a.locationName }))} />
      )}
      <ModalForm open={creating} onOpenChange={setCreating} title="Nouvelle immobilisation" className="sm:max-w-3xl">
        {creating && <AssetForm asset={null} onClose={() => setCreating(false)} />}
      </ModalForm>
    </>
  );
}

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common";
import { TAB_ICONS, TAB_LABELS } from "../../app/routes";
import { ExpenseBudgetTab } from "./ExpenseBudgetTab";
import { InvestmentBudgetTab } from "./InvestmentBudgetTab";
import { BudgetSummaryTab } from "./BudgetSummaryTab";

const TAB_KEYS = ["depenses", "investissements", "suivi"] as const;
type BudgetTab = (typeof TAB_KEYS)[number];

export function BudgetPage() {
  const [params, setParams] = useSearchParams();
  const now = new Date().getFullYear();
  const requestedTab = params.get("tab") as BudgetTab | null;
  const tab: BudgetTab = requestedTab && TAB_KEYS.includes(requestedTab) ? requestedTab : "depenses";
  const requestedYear = Number(params.get("year"));
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : now;

  // Keep the URL (and so the breadcrumb + shareable link) in step with the tab/year actually shown, including the defaults.
  useEffect(() => {
    if (params.get("tab") !== tab || params.get("year") !== String(year)) setParams({ tab, year: String(year) }, { replace: true });
  }, [tab, year, params]);

  const setTab = (v: string) => setParams({ tab: v, year: String(year) }, { replace: true });
  const setYear = (y: number) => setParams({ tab, year: String(y) }, { replace: true });

  return (
    <>
      <PageHeader title="Budget">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Année
          <Input
            type="number" className="w-24" value={year}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v)) setYear(v); }}
          />
        </label>
      </PageHeader>
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList variant="line">
          {TAB_KEYS.map((t) => {
            const Icon = TAB_ICONS["/budget"]?.[t];
            return <TabsTrigger key={t} value={t}>{Icon && <Icon />}{TAB_LABELS["/budget"]?.[t] ?? t}</TabsTrigger>;
          })}
        </TabsList>
      </Tabs>
      {tab === "depenses" && <ExpenseBudgetTab year={year} />}
      {tab === "investissements" && <InvestmentBudgetTab year={year} />}
      {tab === "suivi" && <BudgetSummaryTab year={year} />}
    </>
  );
}

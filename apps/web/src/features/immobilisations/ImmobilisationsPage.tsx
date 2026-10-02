import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common";
import { TAB_ICONS, TAB_LABELS } from "../../app/routes";
import { AssetListTab } from "./AssetListTab";
import { DepreciationTab } from "./DepreciationTab";
import { AssetReportTab } from "./AssetReportTab";

const TAB_KEYS = ["liste", "amortissement", "rapport"] as const;
type AssetPageTab = (typeof TAB_KEYS)[number];

export function ImmobilisationsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as AssetPageTab | null;
  const tab: AssetPageTab = requested && TAB_KEYS.includes(requested) ? requested : "liste";
  // Keep the URL (and so the breadcrumb) in step with the tab actually shown, including the default.
  useEffect(() => { if (params.get("tab") !== tab) setParams({ tab }, { replace: true }); }, [tab, params]);
  const goTo = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader title="Immobilisations" />
      <Tabs value={tab} onValueChange={goTo} className="mb-4">
        <TabsList variant="line">
          {TAB_KEYS.map((t) => {
            const Icon = TAB_ICONS["/immobilisations"]?.[t];
            return <TabsTrigger key={t} value={t}>{Icon && <Icon />}{TAB_LABELS["/immobilisations"]?.[t] ?? t}</TabsTrigger>;
          })}
        </TabsList>
      </Tabs>
      {tab === "liste" && <AssetListTab />}
      {tab === "amortissement" && <DepreciationTab />}
      {tab === "rapport" && <AssetReportTab />}
    </>
  );
}

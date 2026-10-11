import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common";
import { TAB_ICONS, TAB_LABELS } from "../../app/routes";
import { AssetRegistreTab } from "./AssetRegistreTab";
import { AssetInventoryTab } from "./AssetInventoryTab";
import { AssetReportsTab } from "./AssetReportsTab";
import { AssetRequestsPanel } from "./AssetRequestsPanel";

const TAB_KEYS = ["registre", "demandes", "inventaire", "rapports"] as const;
type AssetPageTab = (typeof TAB_KEYS)[number];

export function ImmobilisationsPage() {
  const [params, setParams] = useSearchParams();
  // "liste" was the first tab's old name: keep old bookmarks working.
  const raw = params.get("tab") === "liste" ? "registre" : params.get("tab");
  const requested = raw as AssetPageTab | null;
  const tab: AssetPageTab = requested && TAB_KEYS.includes(requested) ? requested : "registre";
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
      {tab === "registre" && <AssetRegistreTab />}
      {tab === "demandes" && <AssetRequestsPanel />}
      {tab === "inventaire" && <AssetInventoryTab />}
      {tab === "rapports" && <AssetReportsTab />}
    </>
  );
}

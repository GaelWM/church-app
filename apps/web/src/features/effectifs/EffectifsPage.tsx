import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common";
import { AttendanceTab } from "./AttendanceTab";
import { MembersTab } from "./MembersTab";
import { WorkersTab } from "./WorkersTab";

const TABS = [["cultes", "Effectifs des cultes"], ["membres", "Membres"], ["ouvriers", "Ouvriers"]] as const;
type Tab = (typeof TABS)[number][0];

export function EffectifsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = TABS.some(([k]) => k === requested) ? requested! : "cultes";
  useEffect(() => { if (params.get("tab") !== tab) setParams({ tab }, { replace: true }); }, [tab, params]);
  return (
    <>
      <PageHeader title="Effectifs" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-4">
        <TabsList variant="line">{TABS.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}</TabsList>
      </Tabs>
      {tab === "cultes" && <AttendanceTab />}
      {tab === "membres" && <MembersTab />}
      {tab === "ouvriers" && <WorkersTab />}
    </>
  );
}

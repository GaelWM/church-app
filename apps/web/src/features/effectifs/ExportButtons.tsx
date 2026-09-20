import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportTable, type ExportSpec } from "@/lib/export-table";
import { useSession } from "../../core/session";

/** Excel / PDF / print buttons, shown only to users allowed to export. */
export function ExportButtons({ spec }: { spec: () => ExportSpec }) {
  const s = useSession();
  if (!s.can("report.export")) return null;
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="outline" onClick={() => exportTable("xlsx", spec())}><FileSpreadsheet />Excel</Button>
      <Button size="sm" variant="outline" onClick={() => exportTable("pdf", spec())}><FileText />PDF</Button>
      <Button size="sm" variant="outline" onClick={() => exportTable("print", spec())}><Printer />Imprimer</Button>
    </span>
  );
}

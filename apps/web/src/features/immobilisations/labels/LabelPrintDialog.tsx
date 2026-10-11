import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import type { AssetLabelFormat } from "@church/shared";
import { Button } from "@/components/ui/button";
import { ActionButton, Banner, ErrorNote, Field, ModalForm } from "@/components/common";
import { OptionSelect } from "@/components/form-controls";
import { useApi } from "../../../core/api";
import { useInvalidateLedger } from "../../../core/queries";
import { useAssetRefs } from "../queries";
import { buildLabelsPdf, type LabelItem, type LabelVariant } from "./label-pdf";

/**
 * Prints the étiquette (or just the code) of one or several validated assets: single, reprint and batch all go through here.
 * Every print is recorded in the audit trail first (a second one for the same asset is logged as a reprint).
 */
export function LabelPrintDialog({ items, variant, reprint, open, onOpenChange }: {
  items: LabelItem[]; variant: LabelVariant; reprint?: boolean; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const refs = useAssetRefs();
  const [mode, setMode] = useState<AssetLabelFormat["mode"] | "">("");
  const format: AssetLabelFormat | undefined = refs.data ? { ...refs.data.labelFormat, mode: mode || refs.data.labelFormat.mode } : undefined;
  const what = variant === "etiquette" ? (items.length > 1 ? "étiquettes" : "étiquette") : (items.length > 1 ? "codes" : "code");

  const run = useMutation({
    mutationFn: async (action: "print" | "download") => {
      if (!format) throw new Error("Paramètres d'étiquette indisponibles");
      // Opened now, while the click still counts as a user gesture; filled in once the PDF is ready.
      const win = action === "print" ? window.open("about:blank", "_blank") : null;
      try {
        await api.post("/immobilisations/print-log", { ids: items.map((i) => i.id), kind: variant === "etiquette" ? "etiquette" : "code" });
        const doc = await buildLabelsPdf(items, format, window.location.origin, variant);
        if (action === "download") { doc.save(items.length === 1 ? `${variant}-${items[0]!.code}.pdf` : `${variant}s-immobilisations.pdf`); return; }
        doc.autoPrint();
        const url = URL.createObjectURL(doc.output("blob"));
        if (win) win.location.href = url; else doc.save(`${variant}s-immobilisations.pdf`);
      } catch (e) {
        win?.close();
        throw e;
      }
    },
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });

  return (
    <ModalForm open={open} onOpenChange={onOpenChange} className="sm:max-w-md"
      title={`${reprint ? "Réimprimer" : "Imprimer"} ${items.length > 1 ? `${items.length} ${what}` : `l'${variant === "etiquette" ? "étiquette" : "code"}`}`}
      description={items.length === 1 ? `${items[0]!.code} · ${items[0]!.description}` : "Impression en lot des immobilisations sélectionnées."}>
      <div className="space-y-3">
        {reprint && <Banner>Ce document a déjà été imprimé : cette impression sera enregistrée comme une réimpression.</Banner>}
        <Field label="Mise en page">
          <OptionSelect value={format?.mode ?? ""} onValueChange={(v) => setMode(v as AssetLabelFormat["mode"])} disabled={!format}
            options={[{ value: "roll", label: "Une étiquette par page (imprimante d'étiquettes)" }, { value: "sheet", label: "Planche A4 (impression en lot)" }]} />
        </Field>
        {format && <p className="text-xs text-muted-foreground">Étiquette de {format.widthMm} × {format.heightMm} mm{format.mode === "sheet" ? `, ${format.cols} × ${format.rows} par planche` : ""}. Les dimensions se règlent dans Configuration › Immobilisations.</p>}
        <ErrorNote error={run.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <ActionButton type="button" variant="outline" icon={Download} pending={run.isPending && run.variables === "download"} disabled={!format || run.isPending} onClick={() => run.mutate("download")}>Télécharger le PDF</ActionButton>
          <ActionButton type="button" icon={Printer} pending={run.isPending && run.variables === "print"} disabled={!format || run.isPending} onClick={() => run.mutate("print")}>Imprimer</ActionButton>
        </div>
      </div>
    </ModalForm>
  );
}

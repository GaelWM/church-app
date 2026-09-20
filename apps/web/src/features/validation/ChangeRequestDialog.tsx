import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote, Field, FormFooter, FormGrid, ModalForm } from "@/components/common";
import { FormSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import type { Tx } from "../../core/types";

const schema = z.object({
  kind: z.enum(["modification", "annulation"]),
  reason: z.string().trim().min(5, "Motif obligatoire (5 caractères minimum)"),
  description: z.string(), beneficiary: z.string(), documentNumber: z.string(), subCategory: z.string(),
  categoryId: z.string(), departmentId: z.string(),
});
type Values = z.infer<typeof schema>;

/** §27: "Demander une modification / annulation" on a validated entry. Hidden without the permission, in consolidated view, or unless the entry is Validée. */
export function RequestChangeButton({ tx }: { tx: Tx }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  if (!s.can("change.request") || s.consolidated || tx.status !== "validee") return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><FilePenLine />Demander une modification / annulation</Button>
      {open && <ChangeRequestDialog tx={tx} open={open} onOpenChange={setOpen} />}
    </>
  );
}

function ChangeRequestDialog({ tx, open, onOpenChange }: { tx: Tx; open: boolean; onOpenChange: (o: boolean) => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const categories = useCategories(tx.kind === "recette" || tx.kind === "depense" ? tx.kind : undefined);
  const departments = useQuery({ queryKey: useScopedKey("departments"), queryFn: () => api.get<{ id: string; name: string }[]>("/departments") });
  const grouped = !!tx.transferGroupId || !["recette", "depense"].includes(tx.kind);
  const init: Values = {
    kind: "modification", reason: "", description: tx.description ?? "", beneficiary: tx.beneficiary ?? "", documentNumber: tx.documentNumber ?? "",
    subCategory: tx.subCategory ?? "", categoryId: tx.categoryId ?? "", departmentId: tx.departmentId ?? "",
  };
  const { register, control, watch, handleSubmit, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: init });
  const kind = watch("kind");
  const send = useMutation({
    mutationFn: (v: Values) => {
      if (v.kind === "annulation") return api.post("/change-requests", { transactionId: tx.id, kind: v.kind, reason: v.reason });
      const changes: Record<string, string | null> = {};
      for (const k of ["description", "beneficiary", "documentNumber", "subCategory", "categoryId", "departmentId"] as const) {
        if (v[k] === init[k]) continue;
        if (k === "categoryId" && (grouped || !v[k])) continue;
        if (k === "departmentId" && grouped) continue;
        changes[k] = v[k] === "" ? null : v[k];
      }
      return api.post("/change-requests", { transactionId: tx.id, kind: v.kind, reason: v.reason, changes });
    },
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });

  return (
    <ModalForm open={open} onOpenChange={onOpenChange} title={`Demande sur ${tx.reference}`}
      description="Nécessite l'approbation du Trésorier puis du Pasteur. L'écriture reste inchangée d'ici là.">
      <form onSubmit={handleSubmit((v) => send.mutate(v))}>
        <FormGrid>
          <Field label="Type de demande"><FormSelect control={control} name="kind" options={[{ value: "modification", label: "Modification" }, { value: "annulation", label: "Annulation" }]} /></Field>
          <div className="col-span-full">
            <Field label="Motif (obligatoire)" error={errors.reason?.message}>
              <textarea rows={3} autoFocus className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" {...register("reason")} />
            </Field>
          </div>
          {kind === "modification" && (
            <>
              <Field label="Libellé"><Input {...register("description")} /></Field>
              <Field label="Bénéficiaire"><Input {...register("beneficiary")} /></Field>
              <Field label="N° pièce"><Input {...register("documentNumber")} /></Field>
              <Field label="Sous-catégorie"><Input {...register("subCategory")} /></Field>
              {!grouped && <Field label="Catégorie"><FormSelect control={control} name="categoryId" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>}
              {!grouped && <Field label="Département"><FormSelect control={control} name="departmentId" options={[{ value: "", label: "—" }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} /></Field>}
            </>
          )}
        </FormGrid>
        <ErrorNote error={send.error} />
        <FormFooter pending={send.isPending} submitLabel="Envoyer la demande" onCancel={() => onOpenChange(false)} />
      </form>
    </ModalForm>
  );
}

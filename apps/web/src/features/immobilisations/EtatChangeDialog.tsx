import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { ASSET_ETATS, ASSET_ETAT_LABELS, ETATS_REQUIRING_OBSERVATION, isSensitiveEtatChange, type AssetEtat } from "@church/shared";
import { Input } from "@/components/ui/input";
import { Banner, ErrorNote, Field, FormFooter, ModalForm } from "@/components/common";
import { FormSelect } from "@/components/form-controls";
import { useApi } from "../../core/api";
import { useInvalidateLedger } from "../../core/queries";
import type { Asset } from "./types";

const schema = z.object({
  newEtat: z.enum(ASSET_ETATS),
  reason: z.string().trim().min(3, "Motif obligatoire (3 caractères minimum)"),
  observation: z.string(),
}).superRefine((v, ctx) => {
  if ((ETATS_REQUIRING_OBSERVATION as readonly string[]).includes(v.newEtat) && !v.observation.trim())
    ctx.addIssue({ code: "custom", path: ["observation"], message: "Justification obligatoire pour cet état" });
});
type Values = z.infer<typeof schema>;

const MEANING: Record<AssetEtat, string> = {
  bon: "Bien fonctionnel et utilisable normalement.",
  mauvais: "Bien détérioré ou présentant un problème nécessitant éventuellement une réparation.",
  declasse: "Bien qui n'est plus considéré comme utilisable normalement ou qui ne répond plus aux besoins.",
  perdu: "Bien qui n'est plus localisé ou qui n'est plus disponible physiquement.",
};

/** "Changer l'état". Déclassé / Perdu (and leaving them) become a request that the Trésorier and the Pasteur must approve. */
export function EtatChangeDialog({ asset, open, onOpenChange }: { asset: Asset; open: boolean; onOpenChange: (o: boolean) => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const first = ASSET_ETATS.find((e) => e !== asset.etat) ?? "mauvais";
  const { register, control, watch, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema), defaultValues: { newEtat: first, reason: "", observation: "" },
  });
  const newEtat = watch("newEtat");
  const sensitive = isSensitiveEtatChange(asset.etat, newEtat);
  const needsObservation = (ETATS_REQUIRING_OBSERVATION as readonly string[]).includes(newEtat);
  const send = useMutation({
    mutationFn: (v: Values) => api.post(`/immobilisations/${asset.id}/etat`, { newEtat: v.newEtat, reason: v.reason.trim(), observation: v.observation.trim() || null }),
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });
  return (
    <ModalForm open={open} onOpenChange={onOpenChange} title={`Changer l'état de ${asset.code}`} description={`État actuel : ${ASSET_ETAT_LABELS[asset.etat]}`} className="sm:max-w-lg">
      <form onSubmit={handleSubmit((v) => send.mutate(v))} noValidate className="space-y-3">
        <Field label="Nouvel état" error={errors.newEtat?.message}>
          <FormSelect control={control} name="newEtat" options={ASSET_ETATS.filter((e) => e !== asset.etat).map((e) => ({ value: e, label: ASSET_ETAT_LABELS[e] }))} />
        </Field>
        <p className="text-xs text-muted-foreground">{MEANING[newEtat]}</p>
        <Field label="Motif du changement" error={errors.reason?.message}><Input autoFocus placeholder="Panne, réparation, obsolescence, inventaire…" {...register("reason")} /></Field>
        <Field label={needsObservation ? "Justification / observations (obligatoire)" : "Observations (optionnel)"} error={errors.observation?.message}>
          <textarea rows={3} className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" {...register("observation")} />
        </Field>
        {sensitive && <Banner>Ce changement est sensible : il ne prendra effet qu'après l'approbation du Trésorier puis du Pasteur. L'état actuel reste affiché d'ici là.</Banner>}
        <ErrorNote error={send.error} />
        <FormFooter pending={send.isPending} onCancel={() => onOpenChange(false)} submitLabel={sensitive ? "Envoyer pour validation" : "Enregistrer le changement"} />
      </form>
    </ModalForm>
  );
}

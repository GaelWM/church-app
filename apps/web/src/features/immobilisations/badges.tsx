import { ASSET_ETAT_LABELS, ASSET_REQUEST_STATUS_LABELS, ASSET_STATUT_LABELS, type AssetEtat, type AssetStatut, type ChangeRequestStatus } from "@church/shared";
import { ToneBadge, type Tone } from "@/components/common";

const STATUT_TONE: Record<AssetStatut, Tone> = {
  brouillon: "muted", en_attente_validation: "warning", actif: "success", en_amortissement: "success", entierement_amorti: "info",
  cede: "muted", mis_au_rebut: "muted", transfere: "muted", annule: "destructive",
};
const ETAT_TONE: Record<AssetEtat, Tone> = { bon: "success", mauvais: "warning", declasse: "destructive", perdu: "destructive" };
const REQUEST_TONE: Record<ChangeRequestStatus, Tone> = {
  en_attente_tresorier: "warning", approuvee_n1: "info", approuvee_n2: "success", executee: "success", rejetee: "destructive",
};

/** Statut administratif (Brouillon … Annulé): the accounting situation, not the physical condition. */
export const AssetStatutBadge = ({ statut }: { statut: AssetStatut }) => <ToneBadge tone={STATUT_TONE[statut]}>{ASSET_STATUT_LABELS[statut]}</ToneBadge>;
/** État physique (Bon / Mauvais / Déclassé / Perdu). */
export const EtatBadge = ({ etat }: { etat: AssetEtat }) => <ToneBadge tone={ETAT_TONE[etat]}>{ASSET_ETAT_LABELS[etat]}</ToneBadge>;
/** Request status with the spec's wording (En attente / Approuvé par le Trésorier / Approuvé par les deux / Refusé). */
export const RequestStatusBadge = ({ status }: { status: ChangeRequestStatus }) => <ToneBadge tone={REQUEST_TONE[status]}>{ASSET_REQUEST_STATUS_LABELS[status]}</ToneBadge>;

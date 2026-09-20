import { useState, type ReactNode } from "react";
import { BadgeCheck, Eye, Lock, Mail, Scale, ShieldCheck, Workflow } from "lucide-react";
import { ROLE_LABELS, STATUS_LABELS, type Role, type TxStatus } from "@church/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "../../core/session";

/**
 * The validation circuit every transaction goes through, drawn like the state diagram in the design:
 * Brouillon → Soumise → Validée 1 (Trésorier) → Validée (Pasteur), with Rejetée looping back to Soumise.
 * The steps the signed-in role performs are highlighted and explained below the diagram.
 */

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Which transitions each role performs (see packages/shared workflow + permissions). */
const ROLE_STEPS: Record<Role, Step[]> = {
  caissier: [1, 2, 7],
  tresorier: [3, 4],
  pasteur: [5, 6],
  administrateur: [],
  auditeur: [],
};

/** Which states each role acts on (their "to do" boxes). */
const ROLE_NODES: Record<Role, TxStatus[]> = {
  caissier: ["brouillon", "rejetee"],
  tresorier: ["soumise"],
  pasteur: ["validee1"],
  administrateur: [],
  auditeur: [],
};

const STEP_LABEL: Record<Step, string> = {
  1: "Enregistrer", 2: "Soumettre", 3: "Valider", 4: "Rejeter", 5: "Valider", 6: "Rejeter", 7: "Corriger et soumettre",
};

interface Explanation { title: string; icon: ReactNode; steps: ReactNode[]; note?: ReactNode }

const EXPLANATIONS: Record<Role, Explanation> = {
  caissier: {
    title: "Caissier : vous saisissez",
    icon: <BadgeCheck className="size-4" />,
    steps: [
      <><b>1 · Enregistrer</b> l'écriture : elle est en <b>Brouillon</b>, vous pouvez encore la modifier ou la supprimer.</>,
      <><b>2 · Soumettre</b> : l'écriture est verrouillée et part chez le Trésorier (<b>Soumise</b>).</>,
      <><b>7 · Corriger</b> : si elle est <b>Rejetée</b>, lisez le motif (reçu aussi par email), corrigez puis soumettez à nouveau. Elle repasse par les deux validations.</>,
    ],
    note: <>Vous ne validez jamais vos propres écritures. Une fois <b>Validée</b>, une erreur se corrige par <b>contre-passation</b> (nouvelle écriture liée), jamais par modification.</>,
  },
  tresorier: {
    title: "Trésorier : première validation",
    icon: <ShieldCheck className="size-4" />,
    steps: [
      <>Ouvrez <b>À valider</b> : les écritures <b>Soumise</b> vous attendent (résumé par email chaque jour à 18 h).</>,
      <><b>3 · Valider</b> : l'écriture passe en <b>Validée 1</b> et attend le Pasteur. Vous pouvez valider plusieurs lignes d'un coup.</>,
      <><b>4 · Rejeter</b> : un <b>motif écrit est obligatoire</b>; l'écriture retourne au Caissier, qui est prévenu.</>,
    ],
    note: <>Vous ne pouvez pas valider une écriture que vous avez saisie vous-même. Vous pointez aussi le relevé bancaire (rapprochement).</>,
  },
  pasteur: {
    title: "Pasteur : seconde validation",
    icon: <ShieldCheck className="size-4" />,
    steps: [
      <>Ouvrez <b>À valider</b> : les écritures <b>Validée 1</b> ont déjà l'accord du Trésorier.</>,
      <><b>5 · Valider</b> : l'écriture devient <b>Validée</b> et compte désormais dans les soldes, le tableau de bord et les rapports. Une dépense qui rendrait le solde du compte négatif est refusée à cette étape.</>,
      <><b>6 · Rejeter</b> : avec un motif obligatoire, l'écriture retourne au Caissier et repasse par les deux validations.</>,
    ],
    note: <>Vous clôturez aussi le mois (Banques › Clôture mensuelle) : ensuite plus aucune écriture ne peut y être ajoutée.</>,
  },
  administrateur: {
    title: "Administrateur : vous configurez et consultez",
    icon: <Eye className="size-4" />,
    steps: [
      <>Vous voyez toutes les écritures et leur historique, en <b>lecture seule</b>.</>,
      <>Vous ne saisissez ni ne validez aucune écriture : personne ne contrôle une opération de bout en bout.</>,
    ],
    note: <>Vous gérez les paroisses, comptes, catégories, utilisateurs et le taux de change (Configuration).</>,
  },
  auditeur: {
    title: "Auditeur : vous consultez",
    icon: <Eye className="size-4" />,
    steps: [
      <>Vous consultez toutes les écritures, leur historique, les rapports et le journal d'audit, en <b>lecture seule</b>.</>,
      <>Vous ne saisissez ni ne validez rien.</>,
    ],
    note: <>Vous pouvez exporter les rapports en Excel et PDF.</>,
  },
};

// ── Diagram geometry (viewBox 1040 × 236) ────────────────────────────────────
const NODE = { h: 44, y: 38 };
const NODES: Record<TxStatus, { x: number; w: number; y: number; label: string }> = {
  brouillon: { x: 78, w: 104, y: NODE.y, label: STATUS_LABELS.brouillon },
  soumise: { x: 300, w: 104, y: NODE.y, label: STATUS_LABELS.soumise },
  validee1: { x: 540, w: 176, y: NODE.y, label: STATUS_LABELS.validee1 },
  validee: { x: 836, w: 138, y: NODE.y, label: "Validée (Pasteur)" },
  rejetee: { x: 380, w: 110, y: 160, label: STATUS_LABELS.rejetee },
  annulee: { x: 0, w: 0, y: 0, label: STATUS_LABELS.annulee }, // not drawn: cancellation goes through a change request
};

const ARROWS: { step: Step; d: string; badge: [number, number]; label: [number, number, "start" | "middle" | "end"] | null }[] = [
  { step: 1, d: "M21 60 H76", badge: [48, 60], label: null },
  { step: 2, d: "M182 60 H298", badge: [240, 60], label: [240, 46, "middle"] },
  { step: 3, d: "M404 60 H538", badge: [471, 60], label: [471, 46, "middle"] },
  { step: 5, d: "M716 60 H834", badge: [775, 60], label: [775, 46, "middle"] },
  { step: 4, d: "M334 82 V182 H378", badge: [334, 132], label: [318, 136, "end"] },
  { step: 6, d: "M600 82 V182 H492", badge: [600, 132], label: [616, 136, "start"] },
  { step: 7, d: "M424 160 V118 Q424 90 372 82", badge: [424, 140], label: [442, 144, "start"] },
];

function Diagram({ mine, todo, counts }: { mine: Set<Step>; todo: Set<TxStatus>; counts?: Partial<Record<TxStatus, number>> }) {
  return (
    <svg viewBox="0 0 1040 236" role="img" className="min-w-[760px] w-full text-foreground"
      aria-label="Circuit de validation : Brouillon, Soumise, Validée 1 par le Trésorier, Validée par le Pasteur; une écriture Rejetée retourne au Caissier qui la corrige et la soumet à nouveau.">
      <defs>
        {(["own", "other"] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={k === "own" ? "var(--primary)" : "var(--muted-foreground)"} />
          </marker>
        ))}
      </defs>

      {/* start and end markers */}
      <circle cx="14" cy="60" r="7" fill="var(--muted-foreground)" />
      <path d="M974 60 H990" stroke="var(--muted-foreground)" strokeWidth="1.5" markerEnd="url(#arrow-other)" fill="none" />
      <circle cx="1008" cy="60" r="9" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
      <circle cx="1008" cy="60" r="4.5" fill="var(--muted-foreground)" />

      {/* arrows */}
      {ARROWS.map(({ step, d, badge, label }) => {
        const own = mine.has(step);
        return (
          <g key={step}>
            <path d={d} fill="none" stroke={own ? "var(--primary)" : "var(--muted-foreground)"} strokeWidth={own ? 2.5 : 1.5} markerEnd={`url(#arrow-${own ? "own" : "other"})`} strokeOpacity={own || mine.size === 0 ? 1 : 0.55} />
            {label && <text x={label[0]} y={label[1]} textAnchor={label[2]} fontSize="12" fill={own ? "var(--primary)" : "var(--muted-foreground)"} fontWeight={own ? 600 : 400}>{STEP_LABEL[step]}</text>}
            <circle cx={badge[0]} cy={badge[1]} r="10" fill={own ? "var(--primary)" : "var(--card)"} stroke={own ? "var(--primary)" : "var(--muted-foreground)"} strokeWidth="1.2" />
            <text x={badge[0]} y={badge[1] + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill={own ? "var(--primary-foreground)" : "var(--muted-foreground)"}>{step}</text>
          </g>
        );
      })}

      {/* states */}
      {(Object.keys(NODES) as TxStatus[]).filter((k) => k !== "annulee").map((k) => {
        const n = NODES[k];
        const act = todo.has(k);
        const count = counts?.[k];
        return (
          <g key={k}>
            <rect x={n.x} y={n.y} width={n.w} height={NODE.h} rx="10" fill={act ? "color-mix(in oklab, var(--primary) 12%, var(--card))" : "var(--card)"} stroke={act ? "var(--primary)" : "var(--border)"} strokeWidth={act ? 2 : 1.2} />
            <text x={n.x + n.w / 2} y={n.y + NODE.h / 2 + 4.5} textAnchor="middle" fontSize="13.5" fontWeight={act ? 600 : 500} fill="var(--foreground)">{n.label}</text>
            {count !== undefined && count > 0 && (
              <g>
                <circle cx={n.x + n.w - 4} cy={n.y + 2} r="11" fill={act ? "var(--primary)" : "var(--muted-foreground)"} />
                <text x={n.x + n.w - 4} y={n.y + 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--primary-foreground)">{count}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Diagram + role-specific explanation (the modal's content). */
function FlowBody({ counts }: { counts?: Partial<Record<TxStatus, number>> }) {
  const s = useSession();
  const roles: Role[] = s.consolidated ? [] : s.roles;
  const mine = new Set<Step>(roles.flatMap((r) => ROLE_STEPS[r]));
  const todo = new Set<TxStatus>(roles.flatMap((r) => ROLE_NODES[r]));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto"><Diagram mine={mine} todo={todo} counts={counts} /></div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" />
        <span>Seules les écritures <b className="text-foreground">Validées</b> comptent dans les soldes, le tableau de bord et les rapports. Personne ne valide ce qu'il a saisi lui-même, et une écriture validée n'est jamais modifiée.</span>
      </p>

      {s.consolidated ? (
        <p className="flex items-start gap-2 text-sm"><Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" />Vue consolidée : vous consultez toutes les paroisses en lecture seule. Choisissez une paroisse pour agir dans le circuit.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((r) => {
            const e = EXPLANATIONS[r];
            return (
              <div key={r} className="rounded-lg border bg-muted/30 p-3 text-sm">
                <h4 className="mb-2 flex items-center gap-2 font-medium">{e.icon}{e.title}</h4>
                <ol className="space-y-1.5">{e.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                {e.note && <p className="mt-2 flex items-start gap-2 text-muted-foreground">{r === "tresorier" ? <Scale className="mt-0.5 size-4 shrink-0" /> : <Mail className="mt-0.5 size-4 shrink-0" />}<span>{e.note}</span></p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Workflow icon button that opens the workflow, explained for the signed-in role, in a modal. */
export function ValidationFlowButton({ counts }: { counts?: Partial<Record<TxStatus, number>> }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const roles: Role[] = s.consolidated ? [] : s.roles;
  return (
    <>
      <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label="Voir le circuit de validation" title="Voir le circuit de validation"><Workflow /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Workflow className="size-5" />Circuit de validation</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-1.5">
              Comment une écriture est validée{roles.length > 0 && <> · vous êtes :</>}
              {roles.map((r) => <Badge key={r} variant="secondary">{ROLE_LABELS[r]}</Badge>)}
            </DialogDescription>
          </DialogHeader>
          <FlowBody counts={counts} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Count entries by status (for the badges on the diagram). */
export function countByStatus(rows: { status: TxStatus }[] | undefined): Partial<Record<TxStatus, number>> | undefined {
  if (!rows) return undefined;
  const out: Partial<Record<TxStatus, number>> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ACCOUNT_TYPES, CURRENCIES, findRoleConflict, ROLE_LABELS, ROLES, type Role } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader } from "@/components/common";
import { TAB_LABELS } from "../../app/routes";
import { useApi } from "../../core/api";
import { requiredSelect } from "../../core/forms";
import { fmtDate, today } from "../../core/format";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";

type Tab = "users" | "parishes" | "accounts" | "categories" | "rate" | "audit";
const TABS = Object.entries(TAB_LABELS["/configuration"]!) as [Tab, string][];

export function ConfigurationPage() {
  const s = useSession();
  const isAdmin = s.can("config.manage") || s.roles.includes("administrateur");
  const [params, setParams] = useSearchParams();
  const allowed = TABS.filter(([t]) => (t === "audit" ? s.can("audit.view") : isAdmin)).map(([t]) => t);
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && allowed.includes(requested) ? requested : allowed[0] ?? "audit";
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  // Keep the URL (and so the breadcrumb) in step with the tab actually shown, including the default.
  useEffect(() => { if (params.get("tab") !== tab) setParams({ tab }, { replace: true }); }, [tab, params]);
  return (
    <>
      <PageHeader title="Configuration" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList>{TABS.filter(([t]) => allowed.includes(t)).map(([t, l]) => <TabsTrigger key={t} value={t}>{l}</TabsTrigger>)}</TabsList>
      </Tabs>
      {tab === "users" && <Users />}{tab === "parishes" && <Parishes />}{tab === "accounts" && <Accounts />}
      {tab === "categories" && <Categories />}{tab === "rate" && <Rate />}{tab === "audit" && <Audit />}
    </>
  );
}

// ── Users ────────────────────────────────────────────────
const roleEnum = z.enum(ROLES);
const userSchema = z.object({
  fullName: z.string().trim().min(1, "Nom requis"), email: z.string().email("Email invalide"),
  parishId: requiredSelect("Paroisse requise"), role: roleEnum, consolidated: z.boolean(),
});

function Users() {
  const api = useApi();
  const s = useSession();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<any[]>("/users") });
  const [open, setOpen] = useState(false);
  const adminParishes = s.me.parishes.filter((p) => p.roles.includes("administrateur"));
  const [target, setTarget] = useState(adminParishes[0]?.id ?? "");
  const toggle = useMutation({ mutationFn: (v: { id: string; state: "activate" | "deactivate" }) => api.post(`/users/${v.id}/${v.state}`), onSuccess: () => users.refetch() });
  const addRole = useMutation({
    mutationFn: (v: { user: any; parishId: string; role: Role }) => {
      const roles = [...v.user.roles, { parishId: v.parishId, role: v.role, consolidatedAccess: false }];
      const conflict = findRoleConflict(roles.filter((r: any) => r.parishId === v.parishId).map((r: any) => r.role));
      if (conflict) throw new Error(`Profils incompatibles dans une même paroisse : ${conflict.map((r) => ROLE_LABELS[r]).join(" + ")}`);
      return api.put(`/users/${v.user.id}/roles`, { roles });
    },
    onSuccess: () => users.refetch(),
  });
  const pName = (id: string) => s.me.parishes.find((p) => p.id === id)?.name ?? id.slice(0, 6);
  return (
    <>
      <Card title="Utilisateurs" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Utilisateur</Button>}>
        <ErrorNote error={toggle.error ?? addRole.error} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Ajouter un profil dans :
          <NativeSelect size="sm" value={target} onChange={(e) => setTarget(e.target.value)}>{adminParishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
        </div>
        <DataTable rows={users.data ?? []} columns={[
          { header: "Nom", cell: (u) => u.fullName }, { header: "Email", cell: (u) => u.email },
          { header: "Profils", cell: (u) => u.roles.map((r: any) => `${ROLE_LABELS[r.role as Role]} (${pName(r.parishId)})`).join(", ") },
          { header: "Actif", cell: (u) => (u.active ? "Oui" : "Non") },
          { header: "", cell: (u) => (
            <span className="actions">
              <NativeSelect size="sm" defaultValue="" onChange={(e) => { if (e.target.value) { addRole.mutate({ user: u, parishId: target, role: e.target.value as Role }); e.target.value = ""; } }}>
                <option value="">+ profil…</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </NativeSelect>
              {u.id !== s.me.user.id && <Button size="sm" variant={u.active ? "destructive" : "outline"} onClick={() => toggle.mutate({ id: u.id, state: u.active ? "deactivate" : "activate" })}>{u.active ? "Désactiver" : "Réactiver"}</Button>}
            </span>) },
        ]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvel utilisateur" description="Un email d'invitation avec un lien pour définir le mot de passe est envoyé automatiquement.">
        <UserForm parishes={adminParishes} onClose={() => setOpen(false)} onDone={() => users.refetch()} />
      </ModalForm>
    </>
  );
}

function UserForm({ parishes, onClose, onDone }: { parishes: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const { register, handleSubmit, control, formState: { errors } } = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema), defaultValues: { fullName: "", email: "", parishId: parishes[0]?.id ?? "", role: "caissier", consolidated: false },
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof userSchema>) => api.post("/users", { email: v.email, fullName: v.fullName, roles: [{ parishId: v.parishId, role: v.role, consolidatedAccess: v.consolidated }] }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Nom complet" error={errors.fullName?.message}><Input {...register("fullName")} /></Field>
        <Field label="Email" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
        <Field label="Paroisse" error={errors.parishId?.message}><NativeSelect {...register("parishId")}>{parishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
        <Field label="Profil"><NativeSelect {...register("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</NativeSelect></Field>
        <Controller control={control} name="consolidated" render={({ field }) => (
          <label className="col-span-full flex items-center gap-2 text-sm"><Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} /> Vue consolidée (toutes les paroisses, lecture seule)</label>
        )} />
      </FormGrid>
      <div className="mt-3"><ErrorNote error={create.error} /></div>
      <FormFooter pending={create.isPending} onCancel={onClose} submitLabel="Créer et inviter" />
    </form>
  );
}

// ── Parishes ─────────────────────────────────────────────
const parishSchema = z.object({ name: z.string().trim().min(1, "Nom requis"), code: z.string().trim().min(2, "2 caractères minimum").max(10, "10 caractères maximum"), city: z.string().optional() });

function Parishes() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title="Paroisses" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Paroisse</Button>}>
        <DataTable rows={s.me.parishes} columns={[{ header: "Code", cell: (p) => p.code }, { header: "Nom", cell: (p) => p.name }, { header: "Ville", cell: (p) => p.city ?? "" }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvelle paroisse" className="sm:max-w-md"><ParishForm onClose={() => setOpen(false)} /></ModalForm>
    </>
  );
}

function ParishForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof parishSchema>>({ resolver: zodResolver(parishSchema) });
  const create = useMutation({ mutationFn: (v: z.infer<typeof parishSchema>) => api.post("/parishes", { name: v.name, code: v.code.toUpperCase(), city: v.city || undefined }), onSuccess: () => location.reload() });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-3">
      <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
      <Field label="Code (ex. KIN01)" error={errors.code?.message}><Input {...register("code")} /></Field>
      <Field label="Ville"><Input {...register("city")} /></Field>
      <ErrorNote error={create.error} />
      <FormFooter pending={create.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Accounts ─────────────────────────────────────────────
const accountSchema = z.object({ type: z.enum(ACCOUNT_TYPES), currency: z.enum(CURRENCIES), name: z.string().trim().min(1, "Nom requis"), bankName: z.string().optional(), number: z.string().optional() });
const TYPE_LABEL: Record<(typeof ACCOUNT_TYPES)[number], string> = { caisse: "Caisse", banque: "Banque", mobile_money: "Mobile money" };

function Accounts() {
  const s = useSession();
  const accounts = useAccounts();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title={`Comptes — ${s.parish?.name ?? ""}`} actions={!s.consolidated && <Button size="sm" onClick={() => setOpen(true)}><Plus /> Compte</Button>}>
        <DataTable rows={accounts.data ?? []} columns={[{ header: "Nom", cell: (a) => a.name }, { header: "Type", cell: (a) => TYPE_LABEL[a.type] }, { header: "Devise", cell: (a) => a.currency }, { header: "Banque", cell: (a) => a.bankName ?? "" }, { header: "Numéro", cell: (a) => a.number ?? "" }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouveau compte" description="Un compte a une seule devise."><AccountForm onClose={() => setOpen(false)} /></ModalForm>
    </>
  );
}

function AccountForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<z.infer<typeof accountSchema>>({ resolver: zodResolver(accountSchema), defaultValues: { type: "caisse", currency: "CDF", name: "" } });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof accountSchema>) => api.post("/accounts", { parishId: s.parishId, type: v.type, currency: v.currency, name: v.name, bankName: v.bankName || undefined, number: v.number || undefined }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Type"><NativeSelect {...register("type")}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</NativeSelect></Field>
        <Field label="Devise"><NativeSelect {...register("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
        <div className="col-span-full"><Field label="Nom" error={errors.name?.message}><Input placeholder="Caisse CDF, M-Pesa…" {...register("name")} /></Field></div>
        {watch("type") !== "caisse" && (
          <>
            <Field label="Banque / opérateur"><Input {...register("bankName")} /></Field>
            <Field label="Numéro"><Input {...register("number")} /></Field>
          </>
        )}
      </FormGrid>
      <div className="mt-3"><ErrorNote error={create.error} /></div>
      <FormFooter pending={create.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Categories ───────────────────────────────────────────
const categorySchema = z.object({ kind: z.enum(["recette", "depense", "banque"]), name: z.string().trim().min(1, "Nom requis"), group: z.string().optional() });

function Categories() {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const cats = useCategories();
  const [open, setOpen] = useState(false);
  const disable = useMutation({ mutationFn: (id: string) => api.patch(`/categories/${id}`, { active: false }), onSuccess: invalidate });
  return (
    <>
      <Card title="Catégories" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Catégorie</Button>}>
        <ErrorNote error={disable.error} />
        <DataTable rows={cats.data ?? []} columns={[{ header: "Type", cell: (c) => c.kind }, { header: "Groupe", cell: (c) => c.group ?? "" }, { header: "Nom", cell: (c) => c.name }, { header: "", cell: (c) => <Button size="sm" variant="outline" onClick={() => disable.mutate(c.id)}>Désactiver</Button> }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvelle catégorie" className="sm:max-w-md"><CategoryForm onClose={() => setOpen(false)} /></ModalForm>
    </>
  );
}

function CategoryForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof categorySchema>>({ resolver: zodResolver(categorySchema), defaultValues: { kind: "recette", name: "" } });
  const create = useMutation({ mutationFn: (v: z.infer<typeof categorySchema>) => api.post("/categories", { kind: v.kind, name: v.name, group: v.group || undefined }), onSuccess: () => { invalidate(); onClose(); } });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-3">
      <Field label="Type"><NativeSelect {...register("kind")}><option value="recette">Recette</option><option value="depense">Dépense</option><option value="banque">Banque</option></NativeSelect></Field>
      <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
      <Field label="Groupe"><Input {...register("group")} /></Field>
      <ErrorNote error={create.error} />
      <FormFooter pending={create.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Exchange rate ────────────────────────────────────────
const rateSchema = z.object({ rate: z.string().regex(/^\d+([.,]\d{1,4})?$/, "Taux invalide (jusqu'à 4 décimales)"), from: z.string().min(1, "Date requise") });

function Rate() {
  const api = useApi();
  const rates = useQuery({ queryKey: ["rates"], queryFn: () => api.get<{ id: string; rateCdfPerUsd: string; effectiveFrom: string }[]>("/exchange-rates") });
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title="Taux de change (1 USD = X CDF) — historique conservé" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Nouveau taux</Button>}>
        <p className="muted">Le taux est copié sur chaque écriture à la saisie : modifier le taux ne change jamais l'historique. Tous les utilisateurs sont notifiés par email.</p>
        <DataTable rows={rates.data ?? []} columns={[{ header: "Effectif", cell: (r) => fmtDate(r.effectiveFrom) }, { header: "Taux", align: "right", cell: (r) => r.rateCdfPerUsd }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouveau taux de change" className="sm:max-w-md"><RateForm onClose={() => setOpen(false)} onDone={() => rates.refetch()} /></ModalForm>
    </>
  );
}

function RateForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof rateSchema>>({ resolver: zodResolver(rateSchema), defaultValues: { rate: "", from: today() } });
  const create = useMutation({ mutationFn: (v: z.infer<typeof rateSchema>) => api.post("/exchange-rates", { rateCdfPerUsd: v.rate.replace(",", "."), effectiveFrom: v.from }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-3">
      <Field label="1 USD = … CDF" error={errors.rate?.message}><Input autoFocus inputMode="decimal" {...register("rate")} /></Field>
      <Field label="Effectif à partir du" error={errors.from?.message}><Input type="date" {...register("from")} /></Field>
      <ErrorNote error={create.error} />
      <FormFooter pending={create.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Audit ────────────────────────────────────────────────
function Audit() {
  const api = useApi();
  const q = useQuery({ queryKey: useScopedKey("audit"), queryFn: () => api.get<any[]>("/audit") });
  return (
    <Card title="Journal d'audit">
      <DataTable rows={q.data ?? []} columns={[
        { header: "Date", cell: (a) => new Date(a.at).toLocaleString("fr-FR") }, { header: "Action", cell: (a) => a.action },
        { header: "Objet", cell: (a) => `${a.entity} ${String(a.entityId ?? "").slice(0, 8)}` }, { header: "Auteur", cell: (a) => String(a.actorId ?? "").slice(0, 8) },
      ]} />
    </Card>
  );
}

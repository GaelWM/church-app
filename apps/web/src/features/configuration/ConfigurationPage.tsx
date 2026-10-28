import { useEffect, useState } from "react";
import { FormDate, FormSelect, OptionSelect, dateLimits } from "@/components/form-controls";
import { useSearchParams } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Building2, ArrowLeftRight, Network, Pencil, Plus, RotateCcw, ScrollText, Settings, SlidersHorizontal, Tags, Trash2, Users as UsersIcon, Wallet, X } from "lucide-react";
import { ACCOUNT_TYPES, CURRENCIES, FINANCE_ROLES, findRoleConflict, parseAmount, ROLE_LABELS, ROLES, type Role } from "@church/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionButton, Card, DataTable, ErrorNote, Field, FormFooter, FormGrid, ModalForm, PageHeader } from "@/components/common";
import { TAB_ICONS, TAB_LABELS } from "../../app/routes";
import { useApi } from "../../core/api";
import { requiredSelect } from "../../core/forms";
import { fmtDate, today } from "../../core/format";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { AssetsConfig } from "./AssetsConfig";

type Tab = "users" | "parishes" | "accounts" | "categories" | "departements" | "rate" | "audit" | "settings" | "immobilisations";
// "Paramètres" is defined here until routes.ts carries it.
const TABS = Object.entries({ ...TAB_LABELS["/configuration"]!, settings: TAB_LABELS["/configuration"]?.settings ?? "Paramètres" }) as [Tab, string][];
const tabIcon = (t: Tab) => TAB_ICONS["/configuration"]?.[t] ?? SlidersHorizontal;

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
      <PageHeader title="Configuration" icon={Settings} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList variant="line">{TABS.filter(([t]) => allowed.includes(t)).map(([t, l]) => { const Icon = tabIcon(t); return <TabsTrigger key={t} value={t}><Icon />{l}</TabsTrigger>; })}</TabsList>
      </Tabs>
      {tab === "users" && <Users />}{tab === "parishes" && <Parishes />}{tab === "accounts" && <Accounts />}
      {tab === "categories" && <Categories />}{tab === "departements" && <Departments />}{tab === "rate" && <Rate />}{tab === "audit" && <Audit />}{tab === "settings" && <Parameters />}{tab === "immobilisations" && <AssetsConfig />}
    </>
  );
}

// ── Users ────────────────────────────────────────────────
const roleEnum = z.enum(ROLES);
const userSchema = z.object({
  fullName: z.string().trim().min(1, "Nom requis"), email: z.string().email("Email invalide"),
  parishId: requiredSelect("Paroisse requise"), role: roleEnum, consolidated: z.boolean(),
});

type UserRole = { parishId: string; role: Role; consolidatedAccess: boolean };
type User = { id: string; fullName: string; email: string; active: boolean; roles: UserRole[] };

function Users() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const adminParishes = s.me.parishes.filter((p) => p.roles.includes("administrateur"));
  const toggle = useMutation({ mutationFn: (v: { id: string; state: "activate" | "deactivate" }) => api.post(`/users/${v.id}/${v.state}`), onSuccess: () => invalidate() });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/users/${id}`), onSuccess: () => invalidate() });
  const pName = (id: string) => s.me.parishes.find((p) => p.id === id)?.name ?? id.slice(0, 6);
  return (
    <>
      <Card title="Utilisateurs" icon={UsersIcon} actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Utilisateur</Button>}>
        <p className="muted">Seul un compte sans historique (invité par erreur, jamais utilisé) peut être supprimé ; sinon, désactivez-le.</p>
        <ErrorNote error={toggle.error ?? del.error} />
        <DataTable rows={users.data ?? []} loading={users.isLoading} emptyIcon={UsersIcon} empty="Aucun utilisateur" columns={[
          { header: "Nom", cell: (u) => u.fullName }, { header: "Email", cell: (u) => u.email },
          { header: "Profils", cell: (u) => u.roles.map((r) => `${ROLE_LABELS[r.role]} (${pName(r.parishId)})`).join(", ") },
          { header: "Actif", cell: (u) => (u.active ? "Oui" : "Non") },
          { header: "", cell: (u) => (
            <span className="actions">
              <Button size="sm" variant="outline" onClick={() => setEdit(u)}><Pencil />Modifier</Button>
              {u.id !== s.me.user.id && <ActionButton size="sm" variant={u.active ? "destructive" : "outline"} icon={u.active ? Ban : RotateCcw} pending={toggle.isPending && toggle.variables?.id === u.id} onClick={() => toggle.mutate({ id: u.id, state: u.active ? "deactivate" : "activate" })}>{u.active ? "Désactiver" : "Réactiver"}</ActionButton>}
              {u.id !== s.me.user.id && <Button size="icon-sm" variant="ghost" aria-label={`Supprimer ${u.fullName}`} disabled={del.isPending} onClick={() => confirm(`Supprimer définitivement ${u.fullName} ?`) && del.mutate(u.id)}><Trash2 /></Button>}
            </span>) },
        ]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvel utilisateur" description="Un email d'invitation avec un lien pour définir le mot de passe est envoyé automatiquement.">
        <UserForm parishes={adminParishes} onClose={() => setOpen(false)} onDone={() => invalidate()} />
      </ModalForm>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title="Modifier l'utilisateur" description="Un changement d'email est signalé aux administrateurs ; la nouvelle adresse reçoit un email de vérification.">
        {edit && <UserEditForm user={edit} parishes={adminParishes} self={edit.id === s.me.user.id} onClose={() => setEdit(null)} onDone={() => invalidate()} />}
      </ModalForm>
    </>
  );
}

const identitySchema = userSchema.pick({ fullName: true, email: true });

function UserEditForm({ user, parishes, self, onClose, onDone }: { user: User; parishes: { id: string; name: string }[]; self: boolean; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof identitySchema>>({ resolver: zodResolver(identitySchema), defaultValues: { fullName: user.fullName, email: user.email } });
  const [roles, setRoles] = useState<UserRole[]>(user.roles);
  const [parishId, setParishId] = useState(parishes[0]?.id ?? "");
  const [rolesError, setRolesError] = useState<string | null>(null);
  const pName = (id: string) => parishes.find((p) => p.id === id)?.name ?? id.slice(0, 6);
  const inParish = roles.filter((r) => r.parishId === parishId).map((r) => r.role);
  const addRole = (role: Role) => {
    const conflict = findRoleConflict([...inParish, role]);
    if (conflict) { setRolesError(`Profils incompatibles dans une même paroisse : ${conflict.map((r) => ROLE_LABELS[r]).join(" + ")}`); return; }
    setRolesError(null);
    setRoles([...roles, { parishId, role, consolidatedAccess: false }]);
  };
  const save = useMutation({
    mutationFn: async (v: z.infer<typeof identitySchema>) => {
      const changes = { ...(v.fullName !== user.fullName && { fullName: v.fullName }), ...(v.email !== user.email && { email: v.email }) };
      if (Object.keys(changes).length) await api.patch(`/users/${user.id}`, changes);
      if (JSON.stringify(roles) !== JSON.stringify(user.roles)) await api.put(`/users/${user.id}/roles`, { roles });
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: () => onDone(), // the name and email may be saved even if the profiles were not
  });
  // An administrator cannot remove their own Administrateur profile (the server refuses too).
  const locked = (r: UserRole) => self && r.role === "administrateur";
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Nom complet" error={errors.fullName?.message}><Input {...register("fullName")} /></Field>
        <Field label="Email" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
      </FormGrid>
      <div className="mt-4 space-y-2 text-sm">
        <div className="font-medium">Profils</div>
        {roles.map((r, i) => (
          <div key={`${r.parishId}-${r.role}`} className="flex items-center gap-3">
            <span className="flex-1">{ROLE_LABELS[r.role]} <span className="text-muted-foreground">— {pName(r.parishId)}</span></span>
            <label className="flex items-center gap-1.5 text-muted-foreground"><Checkbox checked={r.consolidatedAccess} onCheckedChange={(v) => setRoles(roles.map((x, j) => (j === i ? { ...x, consolidatedAccess: v === true } : x)))} /> Vue consolidée</label>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Retirer ${ROLE_LABELS[r.role]}`} disabled={roles.length === 1 || locked(r)} onClick={() => setRoles(roles.filter((_, j) => j !== i))}><X /></Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <OptionSelect size="sm" className="w-auto min-w-40" value={parishId} onValueChange={setParishId} aria-label="Paroisse du profil" options={parishes.map((p) => ({ value: p.id, label: p.name }))} />
          <OptionSelect size="sm" className="w-auto min-w-40" value="" placeholder="+ profil…" aria-label="Ajouter un profil" onValueChange={(v) => v && addRole(v as Role)} options={ROLES.filter((r) => !inParish.includes(r)).map((r) => (
            { value: r, label: findRoleConflict([...inParish, r]) ? `${ROLE_LABELS[r]} — incompatible` : ROLE_LABELS[r] }
          ))} />
        </div>
        <p className="muted">Un utilisateur garde au moins un profil. Pour lui retirer tout accès, désactivez-le.</p>
      </div>
      <div className="mt-3"><ErrorNote error={rolesError ? new Error(rolesError) : save.error} /></div>
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
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
        <Field label="Paroisse" error={errors.parishId?.message}><FormSelect control={control} name="parishId" options={[...(parishes ?? []).map((p) => ({ value: p.id, label: p.name }))]} /></Field>
        <Field label="Profil"><FormSelect control={control} name="role" options={[...(ROLES ?? []).map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} /></Field>
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
      <Card title="Paroisses" icon={Building2} actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Paroisse</Button>}>
        <DataTable rows={s.me.parishes} emptyIcon={Building2} columns={[{ header: "Code", cell: (p) => p.code }, { header: "Nom", cell: (p) => p.name }, { header: "Ville", cell: (p) => p.city ?? "" }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvelle paroisse" className="sm:max-w-md"><ParishForm onClose={() => setOpen(false)} /></ModalForm>
    </>
  );
}

function ParishForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof parishSchema>>({ resolver: zodResolver(parishSchema) });
  const create = useMutation({ mutationFn: (v: z.infer<typeof parishSchema>) => api.post("/parishes", { name: v.name, code: v.code.toUpperCase(), city: v.city || undefined }), onSuccess: () => { invalidate(); onClose(); } });
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
      <Card title={`Comptes — ${s.parish?.name ?? ""}`} icon={Wallet} actions={!s.consolidated && <Button size="sm" onClick={() => setOpen(true)}><Plus /> Compte</Button>}>
        <DataTable rows={accounts.data ?? []} loading={accounts.isLoading} emptyIcon={Wallet} empty="Aucun compte" columns={[{ header: "Nom", cell: (a) => a.name }, { header: "Type", cell: (a) => TYPE_LABEL[a.type] }, { header: "Devise", cell: (a) => a.currency }, { header: "Banque", cell: (a) => a.bankName ?? "" }, { header: "Numéro", cell: (a) => a.number ?? "" }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouveau compte" description="Un compte a une seule devise."><AccountForm onClose={() => setOpen(false)} /></ModalForm>
    </>
  );
}

function AccountForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<z.infer<typeof accountSchema>>({ resolver: zodResolver(accountSchema), defaultValues: { type: "caisse", currency: "CDF", name: "" } });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof accountSchema>) => api.post("/accounts", { parishId: s.parishId, type: v.type, currency: v.currency, name: v.name, bankName: v.bankName || undefined, number: v.number || undefined }),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
      <FormGrid>
        <Field label="Type"><FormSelect control={control} name="type" options={[...(ACCOUNT_TYPES ?? []).map((t) => ({ value: t, label: TYPE_LABEL[t] }))]} /></Field>
        <Field label="Devise"><FormSelect control={control} name="currency" options={[...(CURRENCIES ?? []).map((c) => ({ value: c, label: c }))]} /></Field>
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
      <Card title="Catégories" icon={Tags} actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Catégorie</Button>}>
        <ErrorNote error={disable.error} />
        <DataTable rows={cats.data ?? []} loading={cats.isLoading} emptyIcon={Tags} columns={[{ header: "Type", cell: (c) => c.kind }, { header: "Groupe", cell: (c) => c.group ?? "" }, { header: "Nom", cell: (c) => c.name }, { header: "", cell: (c) => <ActionButton size="sm" variant="outline" icon={Ban} pending={disable.isPending && disable.variables === c.id} onClick={() => disable.mutate(c.id)}>Désactiver</ActionButton> }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouvelle catégorie" className="sm:max-w-md"><CategoryForm onClose={() => setOpen(false)} /></ModalForm>
    </>
  );
}

function CategoryForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof categorySchema>>({ resolver: zodResolver(categorySchema), defaultValues: { kind: "recette", name: "" } });
  const create = useMutation({ mutationFn: (v: z.infer<typeof categorySchema>) => api.post("/categories", { kind: v.kind, name: v.name, group: v.group || undefined }), onSuccess: () => { invalidate(); onClose(); } });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-3">
      <Field label="Type"><FormSelect control={control} name="kind" options={[{ value: "recette", label: "Recette" }, { value: "depense", label: "Dépense" }, { value: "banque", label: "Banque" }]} /></Field>
      <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
      <Field label="Groupe"><Input {...register("group")} /></Field>
      <ErrorNote error={create.error} />
      <FormFooter pending={create.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Départements ─────────────────────────────────────────
const departmentSchema = z.object({ name: z.string().trim().min(1, "Nom requis").max(100, "100 caractères maximum") });
type Department = { id: string; name: string };

function Departments() {
  const api = useApi();
  const depts = useQuery({ queryKey: useScopedKey("departments"), queryFn: () => api.get<Department[]>("/departments") });
  const [edit, setEdit] = useState<Department | "new" | null>(null);
  return (
    <>
      <Card title="Départements" icon={Network} actions={<Button size="sm" onClick={() => setEdit("new")}><Plus /> Département</Button>}>
        <p className="muted">Proposés pour les ouvriers (Effectifs) et les offrandes d'activités de département. Un département ne se supprime pas : renommez-le si besoin.</p>
        <DataTable rows={depts.data ?? []} loading={depts.isLoading} emptyIcon={Network} empty="Aucun département" columns={[
          { header: "Nom", cell: (d) => d.name, sort: (d) => d.name },
          { header: "", cell: (d) => <Button size="sm" variant="outline" onClick={() => setEdit(d)}><Pencil />Renommer</Button> },
        ]} />
      </Card>
      <ModalForm open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === "new" ? "Nouveau département" : "Renommer le département"} className="sm:max-w-md">
        {edit && <DepartmentForm department={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </ModalForm>
    </>
  );
}

function DepartmentForm({ department, onClose }: { department: Department | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const key = useScopedKey("departments");
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof departmentSchema>>({ resolver: zodResolver(departmentSchema), defaultValues: { name: department?.name ?? "" } });
  const save = useMutation({
    mutationFn: (v: z.infer<typeof departmentSchema>) => department ? api.patch(`/departments/${department.id}`, v) : api.post("/departments", v),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: key }); onClose(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-3">
      <Field label="Nom" error={errors.name?.message}><Input autoFocus {...register("name")} /></Field>
      <ErrorNote error={save.error} />
      <FormFooter pending={save.isPending} onCancel={onClose} />
    </form>
  );
}

// ── Exchange rate ────────────────────────────────────────
const rateSchema = z.object({ rate: z.string().regex(/^\d+([.,]\d{1,4})?$/, "Taux invalide (jusqu'à 4 décimales)"), from: z.string().min(1, "Date requise") });

function Rate() {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const rates = useQuery({ queryKey: ["rates"], queryFn: () => api.get<{ id: string; rateCdfPerUsd: string; effectiveFrom: string }[]>("/exchange-rates") });
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card title="Taux de change (1 USD = X CDF) — historique conservé" icon={ArrowLeftRight} actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Nouveau taux</Button>}>
        <p className="muted">Le taux est copié sur chaque écriture à la saisie : modifier le taux ne change jamais l'historique. Tous les utilisateurs sont notifiés par email.</p>
        <DataTable rows={rates.data ?? []} loading={rates.isLoading} emptyIcon={ArrowLeftRight} empty="Aucun taux défini" columns={[{ header: "Effectif", cell: (r) => fmtDate(r.effectiveFrom) }, { header: "Taux", align: "right", cell: (r) => r.rateCdfPerUsd }]} />
      </Card>
      <ModalForm open={open} onOpenChange={setOpen} title="Nouveau taux de change" className="sm:max-w-md"><RateForm onClose={() => setOpen(false)} onDone={() => invalidate()} /></ModalForm>
    </>
  );
}

function RateForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof rateSchema>>({ resolver: zodResolver(rateSchema), defaultValues: { rate: "", from: today() } });
  const create = useMutation({ mutationFn: (v: z.infer<typeof rateSchema>) => api.post("/exchange-rates", { rateCdfPerUsd: v.rate.replace(",", "."), effectiveFrom: v.from }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-3">
      <Field label="1 USD = … CDF" error={errors.rate?.message}><Input autoFocus inputMode="decimal" {...register("rate")} /></Field>
      <Field label="Effectif à partir du" error={errors.from?.message}><FormDate control={control} name="from" {...dateLimits.effective()} /></Field>
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
    <Card title="Journal d'audit" icon={ScrollText}>
      <DataTable rows={q.data ?? []} loading={q.isLoading} emptyIcon={ScrollText} empty="Aucune action enregistrée" columns={[
        { header: "Date", cell: (a) => new Date(a.at).toLocaleString("fr-FR") }, { header: "Action", cell: (a) => a.action },
        { header: "Objet", cell: (a) => (a.targetName ? `${a.entity} · ${a.targetName}` : `${a.entity} ${String(a.entityId ?? "").slice(0, 8)}`) },
        { header: "Auteur", cell: (a) => (a.actorName ? <span className="flex flex-col leading-tight"><span>{a.actorName}</span><span className="text-xs text-muted-foreground">{a.actorEmail}</span></span> : <span className="text-muted-foreground">Système</span>) },
      ]} />
    </Card>
  );
}

// ── Paramètres (§15.1, §21, §25) ─────────────────────────
interface ParishSettings {
  default_currency: "CDF" | "USD"; piece_number_mode: "manual" | "auto" | "mixed";
  negative_balance_alert: { enabled: boolean; threshold_minor: string };
  alert_recipients: { roles: Role[]; extra_emails: string[] };
  retention_policy_note: string; backup_note: string; closure_rule: "mensuelle" | "annuelle" | "les deux";
}
// bigint-safe minor → decimal string (never divide money as a Number)
const minorToInput = (m: string) => { const neg = m.startsWith("-"); const d = (neg ? m.slice(1) : m).padStart(3, "0"); return `${neg ? "-" : ""}${d.slice(0, -2)},${d.slice(-2)}`; };
const PIECE_MODES = [["manual", "Manuel (saisi par l'utilisateur)"], ["auto", "Automatique (généré)"], ["mixed", "Mixte (généré, modifiable)"]] as const;

function Parameters() {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const q = useQuery({ queryKey: useScopedKey("settings"), queryFn: () => api.get<ParishSettings>("/settings") });
  const [f, setF] = useState<ParishSettings | null>(null);
  const [threshold, setThreshold] = useState("0,00");
  const [extra, setExtra] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setF(q.data); setThreshold(minorToInput(q.data.negative_balance_alert.threshold_minor)); setExtra(q.data.alert_recipients.extra_emails.join(", "));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (v: ParishSettings) => api.put<ParishSettings>("/settings", v),
    onSuccess: () => invalidate(),
  });
  if (!f) return <Card title="Paramètres" icon={SlidersHorizontal}>{q.error ? <ErrorNote error={q.error} /> : <p className="muted">Chargement…</p>}</Card>;
  const set = <K extends keyof ParishSettings>(k: K, v: ParishSettings[K]) => setF({ ...f, [k]: v });
  const submit = () => {
    setErr(null);
    let minor: bigint;
    try { const neg = threshold.trim().startsWith("-"); minor = parseAmount(threshold.trim().replace(/^-/, "")); if (neg) minor = -minor; } catch { setErr("Seuil invalide"); return; }
    const emails = extra.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    save.mutate({ ...f, negative_balance_alert: { ...f.negative_balance_alert, threshold_minor: minor.toString() }, alert_recipients: { ...f.alert_recipients, extra_emails: emails } });
  };
  const toggleRole = (r: Role, on: boolean) => set("alert_recipients", { ...f.alert_recipients, roles: on ? [...new Set([...f.alert_recipients.roles, r])] : f.alert_recipients.roles.filter((x) => x !== r) });
  return (
    <Card title="Paramètres de la paroisse" icon={SlidersHorizontal}>
      <div className="space-y-5 text-sm">
        <Field label="Devise par défaut">
          <OptionSelect className="w-40" value={f.default_currency} onValueChange={(v) => set("default_currency", v as ParishSettings["default_currency"])} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <fieldset className="space-y-1.5"><legend className="mb-1 font-medium">Numérotation des pièces</legend>
          {PIECE_MODES.map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="radio" name="piece_mode" checked={f.piece_number_mode === v} onChange={() => set("piece_number_mode", v)} />{l}</label>)}
        </fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 font-medium">Alerte solde bas / négatif</legend>
          <label className="flex items-center gap-2"><Checkbox checked={f.negative_balance_alert.enabled} onCheckedChange={(v) => set("negative_balance_alert", { ...f.negative_balance_alert, enabled: v === true })} /> Activer l'alerte (email quotidien)</label>
          <Field label="Seuil (montant minimal du solde validé, dans la devise du compte)"><Input className="w-40" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
          <div className="space-y-1"><div className="text-muted-foreground">Destinataires par profil</div>
            {/* The alert shows account balances: only the profiles with financial access may receive it. */}
            <div className="flex flex-wrap gap-x-4 gap-y-1">{FINANCE_ROLES.map((r) => <label key={r} className="flex items-center gap-1.5"><Checkbox checked={f.alert_recipients.roles.includes(r)} onCheckedChange={(v) => toggleRole(r, v === true)} />{ROLE_LABELS[r]}</label>)}</div>
          </div>
          <Field label="Emails supplémentaires (séparés par des virgules)"><Input value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        </fieldset>
        <Field label="Règle de clôture">
          <OptionSelect className="w-48" value={f.closure_rule} onValueChange={(v) => set("closure_rule", v as ParishSettings["closure_rule"])} options={[{ value: "mensuelle", label: "Mensuelle" }, { value: "annuelle", label: "Annuelle" }, { value: "les deux", label: "Mensuelle et annuelle" }]} />
        </Field>
        <Field label="Politique de conservation des données (note)"><textarea className="min-h-16 w-full rounded-md border bg-transparent p-2" value={f.retention_policy_note} onChange={(e) => set("retention_policy_note", e.target.value)} /></Field>
        <Field label="Sauvegarde (note)"><textarea className="min-h-16 w-full rounded-md border bg-transparent p-2" value={f.backup_note} onChange={(e) => set("backup_note", e.target.value)} /></Field>
        <ErrorNote error={err ? new Error(err) : save.error} />
        <div className="flex items-center gap-3"><Button onClick={submit} disabled={save.isPending}>Enregistrer</Button>{save.isSuccess && !save.isPending && <span className="text-muted-foreground">Enregistré</span>}</div>
      </div>
    </Card>
  );
}

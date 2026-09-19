import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { findRoleConflict, ROLE_LABELS, ROLES, type Role } from "@church/shared";
import { useApi } from "../../core/api";
import { fmtDate, today } from "../../core/format";
import { useAccounts, useCategories, useInvalidateLedger, useScopedKey } from "../../core/queries";
import { useSession } from "../../core/session";
import { Card, DataTable, ErrorNote, Field, PageHeader } from "../../components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Tab = "users" | "parishes" | "accounts" | "categories" | "rate" | "audit";
const TABS: [Tab, string][] = [["users", "Utilisateurs"], ["parishes", "Paroisses"], ["accounts", "Comptes"], ["categories", "Catégories"], ["rate", "Taux de change"], ["audit", "Journal d'audit"]];

export function ConfigurationPage() {
  const s = useSession();
  const isAdmin = s.can("config.manage") || s.roles.includes("administrateur");
  const [tab, setTab] = useState<Tab>(isAdmin ? "users" : "audit");
  return (
    <>
      <PageHeader title="Configuration" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4"><TabsList>{TABS.filter(([t]) => (t === "audit" ? s.can("audit.view") : isAdmin)).map(([t, l]) => <TabsTrigger key={t} value={t}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {tab === "users" && <Users />}{tab === "parishes" && <Parishes />}{tab === "accounts" && <Accounts />}
      {tab === "categories" && <Categories />}{tab === "rate" && <Rate />}{tab === "audit" && <Audit />}
    </>
  );
}

function Users() {
  const api = useApi();
  const s = useSession();
  const invalidate = useInvalidateLedger();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<any[]>("/users") });
  const adminParishes = s.me.parishes.filter((p) => p.roles.includes("administrateur"));
  const [f, setF] = useState({ email: "", fullName: "", parishId: adminParishes[0]?.id ?? "", role: "caissier" as Role, consolidated: false });
  const create = useMutation({
    mutationFn: () => api.post("/users", { email: f.email, fullName: f.fullName, roles: [{ parishId: f.parishId, role: f.role, consolidatedAccess: f.consolidated }] }),
    onSuccess: () => { setF({ ...f, email: "", fullName: "" }); invalidate(); users.refetch(); },
  });
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
      <Card title="Nouvel utilisateur">
        <div className="form-grid">
          <Field label="Nom complet"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Paroisse"><NativeSelect value={f.parishId} onChange={(e) => setF({ ...f, parishId: e.target.value })}>{adminParishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
          <Field label="Profil"><NativeSelect value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</NativeSelect></Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground"><Checkbox checked={f.consolidated} onCheckedChange={(v) => setF({ ...f, consolidated: v === true })} /> Vue consolidée</label>
          <Button size="sm" disabled={!f.email || !f.fullName || create.isPending} onClick={() => create.mutate()}>Créer et inviter</Button>
        </div>
        <ErrorNote error={create.error} />
        <p className="muted">Un email d'invitation avec un lien pour définir le mot de passe est envoyé automatiquement.</p>
      </Card>
      <Card title="Utilisateurs">
        <ErrorNote error={toggle.error ?? addRole.error} />
        <DataTable rows={users.data ?? []} columns={[
          { header: "Nom", cell: (u) => u.fullName }, { header: "Email", cell: (u) => u.email },
          { header: "Profils", cell: (u) => u.roles.map((r: any) => `${ROLE_LABELS[r.role as Role]} (${pName(r.parishId)})`).join(", ") },
          { header: "Actif", cell: (u) => (u.active ? "Oui" : "Non") },
          { header: "", cell: (u) => (
            <span className="actions">
              <NativeSelect defaultValue="" onChange={(e) => { if (e.target.value) { addRole.mutate({ user: u, parishId: f.parishId, role: e.target.value as Role }); e.target.value = ""; } }}>
                <option value="">Ajouter un profil ({pName(f.parishId)})…</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </NativeSelect>
              {u.id !== s.me.user.id && <Button size="sm" variant={u.active ? "destructive" : "outline"} onClick={() => toggle.mutate({ id: u.id, state: u.active ? "deactivate" : "activate" })}>{u.active ? "Désactiver" : "Réactiver"}</Button>}
            </span>) },
        ]} />
      </Card>
    </>
  );
}

function Parishes() {
  const api = useApi();
  const s = useSession();
  const [f, setF] = useState({ name: "", code: "", city: "" });
  const create = useMutation({ mutationFn: () => api.post("/parishes", { name: f.name, code: f.code, city: f.city || undefined }), onSuccess: () => location.reload() });
  return (
    <Card title="Paroisses">
      <div className="form-grid">
        <Field label="Nom"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code (ex. KIN01)"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Ville"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Button size="sm" disabled={!f.name || f.code.length < 2 || create.isPending} onClick={() => create.mutate()}>Ajouter</Button>
      </div>
      <ErrorNote error={create.error} />
      <DataTable rows={s.me.parishes} columns={[{ header: "Code", cell: (p) => p.code }, { header: "Nom", cell: (p) => p.name }, { header: "Ville", cell: (p) => p.city ?? "" }]} />
    </Card>
  );
}

function Accounts() {
  const api = useApi();
  const s = useSession();
  const accounts = useAccounts();
  const invalidate = useInvalidateLedger();
  const [f, setF] = useState({ type: "caisse", currency: "CDF", name: "", bankName: "", number: "" });
  const create = useMutation({ mutationFn: () => api.post("/accounts", { parishId: s.parishId, type: f.type, currency: f.currency, name: f.name, bankName: f.bankName || undefined, number: f.number || undefined }), onSuccess: () => { setF({ ...f, name: "", number: "" }); invalidate(); } });
  return (
    <Card title={`Comptes — ${s.parish?.name ?? ""}`}>
      {!s.consolidated && (
        <div className="form-grid">
          <Field label="Type"><NativeSelect value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="mobile_money">Mobile money</option></NativeSelect></Field>
          <Field label="Devise (un compte = une devise)"><NativeSelect value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>CDF</option><option>USD</option></NativeSelect></Field>
          <Field label="Nom"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Caisse CDF, M-Pesa…" /></Field>
          {f.type !== "caisse" && <><Field label="Banque / opérateur"><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field><Field label="Numéro"><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field></>}
          <Button size="sm" disabled={!f.name || create.isPending} onClick={() => create.mutate()}>Ajouter</Button>
        </div>
      )}
      <ErrorNote error={create.error} />
      <DataTable rows={accounts.data ?? []} columns={[{ header: "Nom", cell: (a) => a.name }, { header: "Type", cell: (a) => a.type }, { header: "Devise", cell: (a) => a.currency }, { header: "Banque", cell: (a) => a.bankName ?? "" }, { header: "Numéro", cell: (a) => a.number ?? "" }]} />
    </Card>
  );
}

function Categories() {
  const api = useApi();
  const invalidate = useInvalidateLedger();
  const cats = useCategories();
  const [f, setF] = useState({ kind: "recette", name: "", group: "" });
  const create = useMutation({ mutationFn: () => api.post("/categories", { kind: f.kind, name: f.name, group: f.group || undefined }), onSuccess: () => { setF({ ...f, name: "" }); invalidate(); } });
  const disable = useMutation({ mutationFn: (id: string) => api.patch(`/categories/${id}`, { active: false }), onSuccess: invalidate });
  return (
    <Card title="Catégories">
      <div className="form-grid">
        <Field label="Type"><NativeSelect value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="recette">Recette</option><option value="depense">Dépense</option><option value="banque">Banque</option></NativeSelect></Field>
        <Field label="Nom"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Groupe"><Input value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} /></Field>
        <Button size="sm" disabled={!f.name || create.isPending} onClick={() => create.mutate()}>Ajouter</Button>
      </div>
      <ErrorNote error={create.error} />
      <DataTable rows={cats.data ?? []} columns={[{ header: "Type", cell: (c) => c.kind }, { header: "Groupe", cell: (c) => c.group ?? "" }, { header: "Nom", cell: (c) => c.name }, { header: "", cell: (c) => <Button size="sm" variant="outline" onClick={() => disable.mutate(c.id)}>Désactiver</Button> }]} />
    </Card>
  );
}

function Rate() {
  const api = useApi();
  const rates = useQuery({ queryKey: ["rates"], queryFn: () => api.get<{ id: string; rateCdfPerUsd: string; effectiveFrom: string }[]>("/exchange-rates") });
  const [f, setF] = useState({ rate: "", from: today() });
  const create = useMutation({ mutationFn: () => api.post("/exchange-rates", { rateCdfPerUsd: f.rate.replace(",", "."), effectiveFrom: f.from }), onSuccess: () => { setF({ ...f, rate: "" }); rates.refetch(); } });
  return (
    <Card title="Taux de change (1 USD = X CDF) — historique conservé">
      <div className="form-grid">
        <Field label="1 USD = … CDF"><Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label="Effectif à partir du"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Button size="sm" disabled={!f.rate || create.isPending} onClick={() => create.mutate()}>Enregistrer</Button>
      </div>
      <ErrorNote error={create.error} />
      <p className="muted">Le taux est copié sur chaque écriture à la saisie : modifier le taux ne change jamais l'historique. Tous les utilisateurs sont notifiés par email.</p>
      <DataTable rows={rates.data ?? []} columns={[{ header: "Effectif", cell: (r) => fmtDate(r.effectiveFrom) }, { header: "Taux", align: "right", cell: (r) => r.rateCdfPerUsd }]} />
    </Card>
  );
}

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

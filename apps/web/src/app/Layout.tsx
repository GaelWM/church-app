import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ComponentType } from "react";
import { ArrowDownToLine, ArrowUpFromLine, BookOpen, CheckCheck, Handshake, Landmark, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { Banner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useAuth } from "../core/auth";
import { createApiClient } from "../core/api";
import { flushDrafts, useOnline } from "../core/offline";
import { useParishGuard, useSession } from "../core/session";

export function Layout() {
  const s = useSession();
  const { logout, getToken } = useAuth();
  const online = useOnline();
  const qc = useQueryClient();
  useParishGuard();

  // Send offline drafts (as Brouillon) when the connection returns.
  useEffect(() => {
    if (!online) return;
    flushDrafts((parishId) => createApiClient(getToken, () => parishId)).then((n) => { if (n) qc.invalidateQueries(); });
  }, [online]);

  const items: [string, string, ComponentType<{ className?: string }>, boolean][] = [
    ["/", "Tableau de bord", LayoutDashboard, true],
    ["/recettes", "Recettes", ArrowDownToLine, true],
    ["/depenses", "Dépenses", ArrowUpFromLine, true],
    ["/banques", "Banques", Landmark, true],
    ["/journal", "Journal", BookOpen, true],
    ["/engagements", "Engagements", Handshake, true],
    ["/effectifs", "Effectifs", Users, true],
    ["/validation", "À valider", CheckCheck, s.can("transaction.validate1") || s.can("transaction.validate2")],
    ["/configuration", "Configuration", Settings, s.roles.includes("administrateur") || s.can("audit.view")],
  ];
  const canConsolidate = s.me.parishes.some((p) => p.consolidatedAccess);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col gap-2 border-b bg-sidebar p-3 text-sidebar-foreground md:min-h-screen md:border-r md:border-b-0">
        <h1 className="px-2 pt-1 pb-2 text-sm font-semibold">Comptabilité de l'église</h1>
        <NativeSelect className="w-full" value={s.parishId} onChange={(e) => s.setParishId(e.target.value)} aria-label="Paroisse">
          {s.me.parishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {canConsolidate && <option value="all">Toutes les paroisses (consolidé)</option>}
        </NativeSelect>
        <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
          {items.filter(([, , , show]) => show).map(([to, label, Icon]) => (
            <NavLink
              key={to} to={to} end={to === "/"}
              className={({ isActive }) => cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground")}
            >
              <Icon className="size-4" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden flex-1 md:block" />
        <Separator className="hidden md:block" />
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0 text-xs">
            <div className="truncate font-medium">{s.me.user.fullName}</div>
            <div className="truncate text-muted-foreground">{s.roles.join(", ")}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout()} aria-label="Déconnexion" title="Déconnexion"><LogOut /></Button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
        {!online && <Banner>Hors ligne — les nouvelles écritures sont gardées en brouillon sur cet appareil.</Banner>}
        {s.consolidated && <Banner>Vue consolidée : lecture seule.</Banner>}
        <Outlet />
      </main>
    </div>
  );
}

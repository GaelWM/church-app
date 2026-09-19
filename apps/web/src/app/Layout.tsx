import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType } from "react";
import { ArrowDownToLine, ArrowUpFromLine, BookOpen, Building2, CheckCheck, ChevronDown, Handshake, Landmark, LayoutDashboard, LogOut, Menu, Settings, Users } from "lucide-react";
import { Banner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "../core/auth";
import { createApiClient } from "../core/api";
import { flushDrafts, useOnline } from "../core/offline";
import { useParishGuard, useSession } from "../core/session";
import { Breadcrumbs } from "./Breadcrumbs";
import { PAGE_TITLES } from "./routes";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "/": LayoutDashboard, "/recettes": ArrowDownToLine, "/depenses": ArrowUpFromLine, "/banques": Landmark, "/journal": BookOpen,
  "/engagements": Handshake, "/effectifs": Users, "/validation": CheckCheck, "/configuration": Settings,
};

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const s = useSession();
  const visible: Record<string, boolean> = {
    "/validation": s.can("transaction.validate1") || s.can("transaction.validate2"),
    "/configuration": s.roles.includes("administrateur") || s.can("audit.view"),
  };
  return (
    <nav className="flex flex-col gap-1" aria-label="Navigation principale">
      {Object.entries(PAGE_TITLES).filter(([to]) => visible[to] ?? true).map(([to, label]) => {
        const Icon = ICONS[to]!;
        return (
          <NavLink
            key={to} to={to} end={to === "/"} onClick={onNavigate}
            className={({ isActive }) => cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground")}
          >
            <Icon className="size-4" />{label}
          </NavLink>
        );
      })}
    </nav>
  );
}

const Brand = () => <div className="px-3 pb-3 text-sm font-semibold">Comptabilité de l'église</div>;

export function Layout() {
  const s = useSession();
  const { logout, getToken } = useAuth();
  const online = useOnline();
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  useParishGuard();

  // Send offline drafts (as Brouillon) when the connection returns.
  useEffect(() => {
    if (!online) return;
    flushDrafts((parishId) => createApiClient(getToken, () => parishId)).then((n) => { if (n) qc.invalidateQueries(); });
  }, [online]);

  const canConsolidate = s.me.parishes.some((p) => p.consolidatedAccess);
  const parishLabel = s.parishId === "all" ? "Toutes les paroisses" : s.parish?.name ?? "Paroisse";

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen flex-col border-r bg-sidebar p-3 text-sidebar-foreground md:flex">
        <Brand />
        <SideNav />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-64 bg-sidebar p-3 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navigation principale</SheetDescription>
          <Brand />
          <SideNav onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" onClick={() => setDrawer(true)}><Menu /></Button>
          <div className="min-w-0 flex-1 overflow-hidden"><Breadcrumbs /></div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="max-w-48 shrink-0 sm:shrink" aria-label={`Paroisse : ${parishLabel}`}><Building2 /><span className="hidden truncate sm:inline">{parishLabel}</span><ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Paroisse</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={s.parishId} onValueChange={s.setParishId}>
                {s.me.parishes.map((p) => <DropdownMenuRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuRadioItem>)}
                {canConsolidate && <DropdownMenuRadioItem value="all">Toutes les paroisses (consolidé)</DropdownMenuRadioItem>}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0" aria-label="Compte">
                <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{s.me.user.fullName.slice(0, 1)}</span>
                <span className="hidden max-w-32 truncate md:inline">{s.me.user.fullName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="font-normal">
                <div className="font-medium">{s.me.user.fullName}</div>
                <div className="text-xs text-muted-foreground">{s.me.user.email}</div>
                <div className="text-xs text-muted-foreground">{s.roles.join(", ")}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout()}><LogOut /> Déconnexion</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
          {!online && <Banner>Hors ligne — les nouvelles écritures sont gardées en brouillon sur cet appareil.</Banner>}
          {s.consolidated && <Banner>Vue consolidée : lecture seule.</Banner>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "../core/auth";
import "../core/i18n";
import { ApiContext, ApiError, createApiClient } from "../core/api";
import { SessionProvider, useMe, useSession } from "../core/session";
import { Layout } from "./Layout";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { RecettesPage } from "../features/recettes";
import { DepensesPage } from "../features/depenses";
import { BanquesPage } from "../features/banques/BanquesPage";
import { JournalPage } from "../features/journal/JournalPage";
import { EngagementsPage } from "../features/engagements/EngagementsPage";
import { EffectifsPage } from "../features/effectifs/EffectifsPage";
import { ValidationPage } from "../features/validation/ValidationPage";
import { ConfigurationPage } from "../features/configuration/ConfigurationPage";
import { LogOut, RefreshCw, ServerCrash, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton, PageSpinner } from "@/components/common";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });

function NotConfigured() {
  const { logout } = useAuth();
  return (
    <div className="center"><div className="flex flex-col items-center">
      <ShieldAlert className="mb-3 size-10 text-muted-foreground" />
      <h2 className="mb-2 text-xl font-semibold">Accès non configuré</h2>
      <p className="mb-4 text-muted-foreground">Votre connexion est valide, mais aucun profil actif n'est associé à ce compte.<br />Contactez votre administrateur.</p>
      <Button onClick={() => logout()}><LogOut />Se déconnecter</Button>
    </div></div>
  );
}

// The parish header is read from a ref so the API client stays stable while the selection changes.
const parishRef: { current: string | null } = { current: null };

function Authenticated() {
  const { getToken } = useAuth();
  const api = useMemo(() => createApiClient(getToken, () => parishRef.current ?? localStorage.getItem("church.parish")), [getToken]);
  return (
    <ApiContext.Provider value={api}>
      <Gate />
    </ApiContext.Provider>
  );
}

function Gate() {
  const me = useMe();
  if (me.isLoading) return <PageSpinner label="Chargement de votre session…" />;
  if (me.error instanceof ApiError && me.error.status === 403) return <NotConfigured />;
  if (me.error || !me.data) return (
    <div className="center"><div className="flex flex-col items-center gap-3">
      <ServerCrash className="size-10 text-muted-foreground" />
      <p className="text-destructive">{(me.error as Error | null)?.message || "Impossible de joindre le serveur."}</p>
      <ActionButton variant="outline" icon={RefreshCw} pending={me.isFetching} onClick={() => me.refetch()}>Réessayer</ActionButton>
    </div></div>
  );
  if (!me.data.parishes.length) return <NotConfigured />;
  return (
    <SessionProvider me={me.data}>
      <ParishSync />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="recettes" element={<RecettesPage />} />
          <Route path="depenses" element={<DepensesPage />} />
          <Route path="banques" element={<BanquesPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="engagements" element={<EngagementsPage />} />
          <Route path="effectifs" element={<EffectifsPage />} />
          <Route path="validation" element={<ValidationPage />} />
          <Route path="configuration" element={<ConfigurationPage />} />
        </Route>
      </Routes>
    </SessionProvider>
  );
}

// Keeps the API client's parish header in step with the selected parish.
function ParishSync() {
  parishRef.current = useSession().parishId;
  return null;
}

export function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter><Authenticated /></BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

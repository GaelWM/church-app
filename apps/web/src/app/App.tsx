import { useMemo } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Auth0Provider, useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
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

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });

function NotConfigured() {
  const { logout } = useAuth0();
  return (
    <div className="center"><div>
      <h2>Accès non configuré</h2>
      <p>Votre connexion est valide, mais aucun profil actif n'est associé à ce compte.<br />Contactez votre administrateur.</p>
      <button onClick={() => logout({ logoutParams: { returnTo: location.origin } })}>Se déconnecter</button>
    </div></div>
  );
}

// The parish header is read from a ref so the API client stays stable while the selection changes.
const parishRef: { current: string | null } = { current: null };

function Authenticated() {
  const { getAccessTokenSilently } = useAuth0();
  const api = useMemo(() => createApiClient(async () => (await getAccessTokenSilently()) as string, () => parishRef.current ?? localStorage.getItem("church.parish")), [getAccessTokenSilently]);
  return (
    <ApiContext.Provider value={api}>
      <Gate />
    </ApiContext.Provider>
  );
}

function Gate() {
  const me = useMe();
  if (me.isLoading) return <div className="center"><p className="muted">Chargement…</p></div>;
  if (me.error instanceof ApiError && me.error.status === 403) return <NotConfigured />;
  if (me.error || !me.data) return <div className="center"><p className="error">Impossible de joindre le serveur.</p></div>;
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

const Protected = withAuthenticationRequired(Authenticated, { onRedirecting: () => <div className="center"><p className="muted">Redirection vers la connexion…</p></div> });

export function App() {
  const env = import.meta.env;
  if (!env.VITE_AUTH0_DOMAIN || !env.VITE_AUTH0_CLIENT_ID) {
    return <div className="center"><p>Configurez VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID et VITE_AUTH0_AUDIENCE (voir README).</p></div>;
  }
  return (
    <Auth0Provider
      domain={env.VITE_AUTH0_DOMAIN} clientId={env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{ redirect_uri: window.location.origin, audience: env.VITE_AUTH0_AUDIENCE }}
      cacheLocation="localstorage" useRefreshTokens
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter><Protected /></BrowserRouter>
      </QueryClientProvider>
    </Auth0Provider>
  );
}

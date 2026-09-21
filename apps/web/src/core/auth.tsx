import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LogIn, RefreshCw, ServerCrash, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSpinner } from "@/components/common";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";

export interface AuthApi { getToken: () => Promise<string>; logout: () => void }
const Ctx = createContext<AuthApi | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Auth missing");
  return c;
};

/** Local development only (VITE_DEV_AUTH=1): pick a seeded demo user; the API accepts "dev:<id>" tokens. */
export const DEV_AUTH = import.meta.env.VITE_DEV_AUTH === "1";
const DEV_KEY = "church.devUser";

function DevAuth({ children }: { children: ReactNode }) {
  const [user, setUser] = useState(() => localStorage.getItem(DEV_KEY));
  const [users, setUsers] = useState<{ auth0Id: string; fullName: string; email: string }[] | null>(null);
  useEffect(() => {
    if (!user) fetch("/api/dev/users").then((r) => r.json()).then(setUsers).catch(() => setUsers([]));
  }, [user]);
  if (!user && users === null) return <PageSpinner label="Chargement des utilisateurs de démonstration…" />;
  if (!user) {
    return (
      <div className="center"><div className="flex flex-col items-center">
        <LogIn className="mb-3 size-10 text-muted-foreground" />
        <h2 className="mb-1 text-xl font-semibold">Connexion (mode développement)</h2>
        <p className="mb-4 text-muted-foreground">Choisissez un utilisateur de démonstration.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {users!.map((u) => <Button key={u.auth0Id} variant="outline" onClick={() => { localStorage.setItem(DEV_KEY, u.auth0Id); setUser(u.auth0Id); }}><UserRound />{u.fullName}</Button>)}
        </div>
        {!users!.length && <p className="mt-3 flex items-center gap-2 text-destructive"><ServerCrash className="size-4" />Aucun utilisateur : lancez « bun run dev:setup » puis démarrez l'API.</p>}
      </div></div>
    );
  }
  const api: AuthApi = {
    getToken: async () => `dev:${user}`,
    logout: () => { localStorage.removeItem(DEV_KEY); localStorage.removeItem("church.parish"); location.reload(); },
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function Auth0Bridge({ children }: { children: ReactNode }) {
  const { getAccessTokenSilently, logout } = useAuth0();
  // Stable identity: consumers memoise the API client on getToken, so a new object per render would rebuild it and re-run its effects.
  const api = useMemo<AuthApi>(() => ({
    getToken: async () => (await getAccessTokenSilently()) as string,
    logout: () => logout({ logoutParams: { returnTo: location.origin } }),
  }), [getAccessTokenSilently, logout]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
/**
 * Sign in once, but never auto-retry after a failure: a failed code exchange (`?code=&state=`) used to bounce
 * straight back to the login page, which returned a new code, forever. Show the error instead.
 */
function Auth0Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, loginWithRedirect } = useAuth0();
  const login = () => loginWithRedirect({ appState: { returnTo: location.pathname + location.search } });
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !error) void login();
  }, [isLoading, isAuthenticated, error]);
  if (error) return (
    <div className="center"><div className="flex flex-col items-center gap-3">
      <ServerCrash className="size-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">Connexion impossible</h2>
      <p className="max-w-md text-center text-destructive">{error.message}</p>
      <Button variant="outline" onClick={() => { history.replaceState({}, "", "/"); void login(); }}><RefreshCw />Réessayer</Button>
    </div></div>
  );
  if (isLoading || !isAuthenticated) return <PageSpinner label="Redirection vers la connexion…" />;
  return <Auth0Bridge>{children}</Auth0Bridge>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (DEV_AUTH) return <DevAuth>{children}</DevAuth>;
  const env = import.meta.env;
  if (!env.VITE_AUTH0_DOMAIN || !env.VITE_AUTH0_CLIENT_ID) {
    return <div className="center"><p>Configurez VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID et VITE_AUTH0_AUDIENCE, ou lancez « bun run dev » pour le mode local.</p></div>;
  }
  return (
    <Auth0Provider domain={env.VITE_AUTH0_DOMAIN} clientId={env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{ redirect_uri: window.location.origin, audience: env.VITE_AUTH0_AUDIENCE, scope: "openid profile email offline_access" }} cacheLocation="localstorage" useRefreshTokens
      onRedirectCallback={(appState) => history.replaceState({}, "", appState?.returnTo || "/")}>
      <Auth0Gate>{children}</Auth0Gate>
    </Auth0Provider>
  );
}

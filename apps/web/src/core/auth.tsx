import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Auth0Provider, useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";

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
  const [users, setUsers] = useState<{ auth0Id: string; fullName: string; email: string }[]>([]);
  useEffect(() => {
    if (!user) fetch("/api/dev/users").then((r) => r.json()).then(setUsers).catch(() => setUsers([]));
  }, [user]);
  if (!user) {
    return (
      <div className="center"><div>
        <h2 className="mb-1 text-xl font-semibold">Connexion (mode développement)</h2>
        <p className="mb-4 text-muted-foreground">Choisissez un utilisateur de démonstration.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {users.map((u) => <Button key={u.auth0Id} variant="outline" onClick={() => { localStorage.setItem(DEV_KEY, u.auth0Id); setUser(u.auth0Id); }}>{u.fullName}</Button>)}
        </div>
        {!users.length && <p className="mt-3 text-destructive">Aucun utilisateur : lancez « bun run dev:setup » puis démarrez l'API.</p>}
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
  const api: AuthApi = {
    getToken: async () => (await getAccessTokenSilently()) as string,
    logout: () => logout({ logoutParams: { returnTo: location.origin } }),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
const ProtectedBridge = withAuthenticationRequired(Auth0Bridge, { onRedirecting: () => <div className="center"><p className="text-muted-foreground">Redirection vers la connexion…</p></div> });

export function AuthProvider({ children }: { children: ReactNode }) {
  if (DEV_AUTH) return <DevAuth>{children}</DevAuth>;
  const env = import.meta.env;
  if (!env.VITE_AUTH0_DOMAIN || !env.VITE_AUTH0_CLIENT_ID) {
    return <div className="center"><p>Configurez VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID et VITE_AUTH0_AUDIENCE, ou lancez « bun run dev » pour le mode local.</p></div>;
  }
  return (
    <Auth0Provider domain={env.VITE_AUTH0_DOMAIN} clientId={env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{ redirect_uri: window.location.origin, audience: env.VITE_AUTH0_AUDIENCE }} cacheLocation="localstorage" useRefreshTokens>
      <ProtectedBridge>{children}</ProtectedBridge>
    </Auth0Provider>
  );
}

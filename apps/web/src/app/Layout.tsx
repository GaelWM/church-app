import { NavLink, Outlet } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { flushDrafts, useOnline } from "../core/offline";
import { createApiClient } from "../core/api";
import { useParishGuard, useSession } from "../core/session";

export function Layout() {
  const s = useSession();
  const { logout, getAccessTokenSilently } = useAuth0();
  const online = useOnline();
  const qc = useQueryClient();
  useParishGuard();

  // Send offline drafts (as Brouillon) when the connection returns.
  useEffect(() => {
    if (!online) return;
    flushDrafts((parishId) => createApiClient(async () => (await getAccessTokenSilently()) as string, () => parishId)).then((n) => { if (n) qc.invalidateQueries(); });
  }, [online]);

  const items: [string, string, boolean][] = [
    ["/", "Tableau de bord", true],
    ["/recettes", "Recettes", true],
    ["/depenses", "Dépenses", true],
    ["/banques", "Banques", true],
    ["/journal", "Journal", true],
    ["/engagements", "Engagements", true],
    ["/effectifs", "Effectifs", true],
    ["/validation", "À valider", s.can("transaction.validate1") || s.can("transaction.validate2")],
    ["/configuration", "Configuration", s.roles.includes("administrateur") || s.can("audit.view")],
  ];
  const canConsolidate = s.me.parishes.some((p) => p.consolidatedAccess);

  return (
    <div className="shell">
      <nav className="sidebar">
        <h1>Comptabilité de l'église</h1>
        <select value={s.parishId} onChange={(e) => s.setParishId(e.target.value)} aria-label="Paroisse">
          {s.me.parishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {canConsolidate && <option value="all">Toutes les paroisses (consolidé)</option>}
        </select>
        {items.filter(([, , show]) => show).map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
        <div style={{ flex: 1 }} />
        <small style={{ padding: "0 10px", opacity: 0.8 }}>{s.me.user.fullName}<br />{s.roles.join(", ")}</small>
        <a href="#" onClick={(e) => { e.preventDefault(); logout({ logoutParams: { returnTo: location.origin } }); }}>Déconnexion</a>
      </nav>
      <main>
        {!online && <div className="banner">Hors ligne — les nouvelles écritures sont gardées en brouillon sur cet appareil.</div>}
        {s.consolidated && <div className="banner">Vue consolidée : lecture seule.</div>}
        <Outlet />
      </main>
    </div>
  );
}

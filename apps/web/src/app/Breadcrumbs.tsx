import { Fragment } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { PAGE_TITLES, TAB_LABELS } from "./routes";

/** Accueil › Page › Onglet (the tab comes from the ?tab= search parameter on pages that have tabs). */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const page = PAGE_TITLES[pathname] ?? "";
  const tab = TAB_LABELS[pathname]?.[params.get("tab") ?? ""];

  const crumbs: { label: string; to?: string }[] = [];
  if (pathname !== "/") crumbs.push({ label: "Accueil", to: "/" });
  crumbs.push({ label: page, to: tab ? pathname : undefined });
  if (tab) crumbs.push({ label: tab });

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap whitespace-nowrap">
        {crumbs.map((c, i) => (
          <Fragment key={c.label}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {c.to ? <BreadcrumbLink asChild><Link to={c.to}>{c.label}</Link></BreadcrumbLink> : <BreadcrumbPage>{c.label}</BreadcrumbPage>}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

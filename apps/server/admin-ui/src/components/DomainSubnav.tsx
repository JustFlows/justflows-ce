import { useLocation } from "react-router-dom";
import { NavLink } from "../admin-router";
import { internalAdminPath } from "../admin-path";
import { useT } from "../i18n/I18nProvider";
import { navLabel, type NavDomain } from "../config/admin-nav";

type Props = {
  domain: NavDomain;
};

export default function DomainSubnav({ domain }: Props) {
  const { t, locale } = useT();
  const pathname = internalAdminPath(useLocation().pathname);
  const opens = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  /** A tab is not also active while a more specific tab under it is (Users vs Users → Your account). */
  const exact = (to: string) => domain.items.some((other) => other.to !== to && other.to.startsWith(`${to}/`) && opens(other.to));

  return (
    <nav className="jf-domainnav" aria-label={navLabel(t, domain, locale)}>
      {domain.items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end || exact(item.to)} className="jf-domainnav__link">
          <span className="jf-domainnav__icon" aria-hidden="true">{item.icon}</span>
          {navLabel(t, item, locale)}
        </NavLink>
      ))}
    </nav>
  );
}

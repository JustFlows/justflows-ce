import { NavLink } from "react-router-dom";
import { useT } from "../i18n/I18nProvider";
import { navLabel, type NavDomain } from "../config/admin-nav";

type Props = {
  domain: NavDomain;
};

export default function DomainSubnav({ domain }: Props) {
  const { t } = useT();

  return (
    <nav className="jf-domainnav" aria-label={t(domain.key)}>
      {domain.items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="jf-domainnav__link">
          <span className="jf-domainnav__icon" aria-hidden="true">{item.icon}</span>
          {navLabel(t, item)}
        </NavLink>
      ))}
    </nav>
  );
}

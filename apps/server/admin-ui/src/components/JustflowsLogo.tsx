import logoUrl from "../assets/justflows-logo.png";

/** Product mark — not the site logo. Not user-configurable. */
export function JustflowsLogo() {
  return (
    <img
      src={logoUrl}
      alt=""
      width={28}
      height={28}
      className="jf-brand__logo"
      draggable={false}
    />
  );
}

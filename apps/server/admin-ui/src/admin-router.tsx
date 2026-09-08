// SPDX-License-Identifier: MIT
import { forwardRef, useCallback } from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  Navigate as RouterNavigate,
  useNavigate as useRouterNavigate,
  type LinkProps,
  type NavLinkProps,
  type NavigateProps,
  type NavigateFunction,
  type NavigateOptions,
  type To,
} from "react-router-dom";
import { publicAdminPath } from "./admin-path";

function publicTo(to: To): To {
  return typeof to === "string"
    ? publicAdminPath(to)
    : { ...to, pathname: to.pathname == null ? to.pathname : publicAdminPath(to.pathname) };
}

// Resolve URLs before React Router renders hrefs, including during SSR, so
// copying links and opening new tabs use the same URL as client navigation.
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...props }, ref) {
  return <RouterLink {...props} to={publicTo(to)} ref={ref} />;
});

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { to, ...props },
  ref,
) {
  return <RouterNavLink {...props} to={publicTo(to)} ref={ref} />;
});

export function Navigate({ to, ...props }: NavigateProps) {
  return <RouterNavigate {...props} to={publicTo(to)} />;
}

export function useNavigate(): NavigateFunction {
  const navigate = useRouterNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") return navigate(to);
      return navigate(publicTo(to), options);
    },
    [navigate],
  ) as NavigateFunction;
}

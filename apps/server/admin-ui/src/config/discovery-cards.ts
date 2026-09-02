/**
 * Curated links shown in the Admin Home welcome / discovery panel. Static and
 * bundled — no remote fetch — so the panel renders identically offline and can
 * never inject remote markup or scripts. External links point at justflows.com
 * (and its Discord); internal hrefs are filtered through `canAccessPath` before
 * rendering, the same as the dashboard tiles.
 */
export type DiscoveryCard = {
  id: string;
  icon: string;
  href: string;
  /** External links open in a new tab and are always shown; internal links are role-gated. */
  external: boolean;
  titleKey: string;
  descKey: string;
};

export const DISCOVERY_CARDS: DiscoveryCard[] = [
  {
    id: "docs",
    icon: "📚",
    href: "https://justflows.com/documentation",
    external: true,
    titleKey: "dashboard.welcome.cards.docs.title",
    descKey: "dashboard.welcome.cards.docs.desc",
  },
  {
    id: "marketplace",
    icon: "🧩",
    href: "https://justflows.com/marketplace",
    external: true,
    titleKey: "dashboard.welcome.cards.marketplace.title",
    descKey: "dashboard.welcome.cards.marketplace.desc",
  },
  {
    id: "updates",
    icon: "⬆️",
    href: "/admin/updates",
    external: false,
    titleKey: "dashboard.welcome.cards.updates.title",
    descKey: "dashboard.welcome.cards.updates.desc",
  },
  {
    id: "roadmap",
    icon: "🗺️",
    href: "https://justflows.com/roadmap",
    external: true,
    titleKey: "dashboard.welcome.cards.roadmap.title",
    descKey: "dashboard.welcome.cards.roadmap.desc",
  },
  {
    id: "community",
    icon: "💬",
    href: "https://discord.gg/TMgPNwp3TP",
    external: true,
    titleKey: "dashboard.welcome.cards.community.title",
    descKey: "dashboard.welcome.cards.community.desc",
  },
];

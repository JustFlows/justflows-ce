import { translateEnglish, type Translate } from "../../../i18n/translate";
import { useEffect, useState } from "react";
import { usePluginMenu } from "@components/PluginMenuProvider";
import { useT } from "../../../i18n/I18nProvider";

interface RegistryPrice {
  amount: number;
  currency: string;
  interval?: "once" | "month" | "year";
}

interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  publisher?: string;
  downloads: number;
  category: string;
  type: "plugin" | "theme";
  tags: string[];
  channel?: "community" | "commercial";
  pricing?: { type: "free" | "paid"; amount?: number; currency?: string };
  registry?: {
    commercialMarketplace?: boolean;
    listed?: boolean;
    free?: boolean;
    comingSoon?: boolean;
    price?: RegistryPrice;
  };
}

export function listingIsVisible(item: MarketplaceItem): boolean {
  if (typeof item.registry?.listed === "boolean") return item.registry.listed;
  return true;
}

export function listingIsPaid(item: MarketplaceItem): boolean {
  if (typeof item.registry?.free === "boolean") return !item.registry.free;
  return item.pricing?.type === "paid" || item.channel === "commercial";
}

export function listingIsComingSoon(item: MarketplaceItem): boolean {
  return item.registry?.comingSoon === true;
}

export function listingPriceLabel(item: MarketplaceItem, t: Translate = translateEnglish): string | null {
  if (!listingIsPaid(item)) return null;
  const price = item.registry?.price;
  const amount = price?.amount ?? item.pricing?.amount;
  const currency = price?.currency ?? item.pricing?.currency;
  if (amount == null || !currency) return listingIsPaid(item) ? t("common.paid") : null;
  try {
    const formatted = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
    if (price?.interval === "month") return `${formatted} / month`;
    if (price?.interval === "year") return `${formatted} / year`;
    return formatted;
  } catch {
    return `${amount} ${currency}`;
  }
}

export function installedPackageIds(
  plugins: { id?: string; plugin_id?: string }[],
  themes: { themeId?: string; theme_id?: string; id?: string }[],
): Set<string> {
  return new Set([
    ...plugins.map((plugin) => plugin.id ?? plugin.plugin_id),
    ...themes.map((theme) => theme.themeId ?? theme.theme_id ?? theme.id),
  ].filter((id): id is string => Boolean(id)));
}

const CATEGORIES = ["All", "Plugins", "Themes", "SEO", "Forms", "Analytics", "Media", "E-commerce"];

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  All: "marketplace.categories.all",
  Plugins: "marketplace.categories.plugins",
  Themes: "marketplace.categories.themes",
  SEO: "marketplace.categories.seo",
  Forms: "marketplace.categories.forms",
  Analytics: "marketplace.categories.analytics",
  Media: "marketplace.categories.media",
  "E-commerce": "marketplace.categories.ecommerce",
};

export default function MarketplacePage() {
  const { t } = useT();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const { refresh: refreshMenu } = usePluginMenu();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [marketRes, pluginsRes, themesRes] = await Promise.all([
          fetch("/api/marketplace"),
          fetch("/api/plugins"),
          fetch("/api/themes"),
        ]);
        const market = (await marketRes.json()) as { items?: MarketplaceItem[]; error?: string };
        if (market.error) throw new Error(market.error);
        const plugins = (await pluginsRes.json()) as { plugins?: { id?: string; plugin_id?: string }[] };
        const themes = (await themesRes.json()) as {
          themes?: { themeId?: string; theme_id?: string; id?: string }[];
        };
        if (cancelled) return;
        setItems(Array.isArray(market.items) ? market.items.filter(listingIsVisible) : []);
        setInstalled(installedPackageIds(plugins.plugins ?? [], themes.themes ?? []));
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = items.filter((item) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase()) ||
      item.tags.some((t) => t.includes(search.toLowerCase()));

    const matchesCategory =
      category === "All" ||
      (category === "Plugins" && item.type === "plugin") ||
      (category === "Themes" && item.type === "theme") ||
      item.category === category;

    return matchesSearch && matchesCategory;
  });

  async function install(item: MarketplaceItem) {
    setInstalling(item.id);
    setError("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch("/api/marketplace/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: item.type, id: item.id, version: item.version }),
        signal: controller.signal,
      });
      const data = await res.json() as { error?: string; checkoutUrl?: string };
      if (res.status === 403) {
        throw new Error(data.error ?? t("marketplace.comingSoonInstallError"));
      }
      if (res.status === 402) {
        window.open(data.checkoutUrl ?? "https://justflows.com/marketplace", "_blank");
        throw new Error(data.error ?? t("marketplace.commercialListingError"));
      }
      if (!res.ok) throw new Error(data.error ?? t("marketplace.installFailed"));
      setInstalled((prev) => new Set(prev).add(item.id));
      // A newly installed plugin may own admin pages — surface them right away.
      if (item.type === "plugin") await refreshMenu();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(t("marketplace.installTimeout"));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      window.clearTimeout(timer);
      setInstalling(null);
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("marketplace.title")}</h1>
          <p>{t("marketplace.subtitle")}</p>
        </div>
      </header>

      <div className="jf-stack jf-stack--sm">
        {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
        <input
          type="search"
          className="jf-input"
          placeholder={t("marketplace.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("marketplace.searchAriaLabel")}
        />
        <div className="jf-filterbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className="jf-chip"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {t(CATEGORY_LABEL_KEYS[cat] ?? cat)}
            </button>
          ))}
          <span className="jf-meta" style={{ marginInlineStart: "auto" }}>
            {loading ? t("common.loading") : t("marketplace.resultsCount", { count: filtered.length })}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">🔍</span>
            <span className="jf-empty__title">{loading ? t("marketplace.loadingCatalogue") : t("marketplace.emptyTitle")}</span>
            <p>{loading ? t("marketplace.loadingListings") : t("marketplace.emptyDesc")}</p>
          </div>
        </div>
      ) : (
        <div className="jf-cardgrid">
          {filtered.map((item) => {
            const isInstalling = installing === item.id;
            const isInstalled = installed.has(item.id);
            const paid = listingIsPaid(item);
            const comingSoon = listingIsComingSoon(item);
            const priceLabel = listingPriceLabel(item, t);

            return (
              <div key={item.id} className="jf-card">
                <div className="jf-card__body jf-stack jf-stack--sm" style={{ height: "100%" }}>
                  <div className="jf-row">
                    <span className={`jf-badge ${item.type === "theme" ? "jf-badge--warn" : "jf-badge--info"}`}>
                      {item.type}
                    </span>
                    {comingSoon && <span className="jf-badge jf-badge--warn">{t("marketplace.comingSoon")}</span>}
                    {paid && <span className="jf-badge">{priceLabel ?? t("common.paid")}</span>}
                    <span className="jf-meta" style={{ marginInlineStart: "auto" }}>
                      ↓ {item.downloads.toLocaleString()}
                    </span>
                  </div>

                  <h3 className="jf-section-title">{item.name}</h3>
                  <p className="jf-list__desc" style={{ flex: 1 }}>{item.description}</p>
                  <p className="jf-meta">{t("marketplace.versionBy", { version: item.version, publisher: item.publisher ?? item.author ?? "Justflows" })}</p>

                  <button
                    className={`jf-btn jf-btn--block ${isInstalled ? "jf-btn--success" : isInstalling || comingSoon ? "jf-btn--ghost" : "jf-btn--primary"}`}
                    onClick={() => {
                      if (!comingSoon) void install(item);
                    }}
                    disabled={isInstalling || isInstalled || comingSoon}
                  >
                    {isInstalled
                      ? t("marketplace.installedLabel")
                      : isInstalling
                        ? t("marketplace.installing")
                        : comingSoon
                          ? t("marketplace.comingSoon")
                          : paid
                            ? t("marketplace.getOnJustflows")
                            : t("marketplace.install")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

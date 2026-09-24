import { translateEnglish, type Translate } from "../../i18n/translate";
import type { BlockNode } from "./types";
import { uid } from "../../lib/uid";

function newId(): string {
  return uid();
}

export function defaultProps(t: Translate): Record<string, Record<string, unknown>> {
return {
  "core.section": { background: "default", padding: "lg", align: "left" },
  "core.container": { width: "default" },
  "core.group": {},
  "core.columns": { columns: 2, gap: "md" },
  "core.column": {},
  "core.hero": {
    heading: t("ui.blockDefaults.buildSomethingGreat"),
    subheading: t("ui.blockDefaults.aCleanModernPageBuilderForYourSite"),
    buttonLabel: t("ui.blockDefaults.getStarted"),
    buttonUrl: "/",
    backgroundImage: "",
    align: "center",
  },
  "core.features": {
    heading: t("ui.blockDefaults.features"),
    columns: 3,
    items: [
      { icon: "⚡", title: t("ui.blockDefaults.fast"), description: t("ui.blockDefaults.lightweightAndPerformant") },
      { icon: "🎨", title: t("ui.blockDefaults.flexible"), description: t("ui.blockDefaults.sectionsAndBlocksYouControl") },
      { icon: "🔒", title: t("ui.blockDefaults.secure"), description: t("ui.blockDefaults.yourContentStaysOnYourServer") },
    ],
  },
  "core.cta": {
    heading: t("ui.blockDefaults.readyToGetStarted"),
    text: t("ui.blockDefaults.createBeautifulPagesInMinutes"),
    buttonLabel: t("ui.blockDefaults.contactUs"),
    buttonUrl: "/contact",
    variant: "primary",
  },
  "core.paragraph": { text: "" },
  "core.heading": { text: "", level: 2 },
  "core.image": { src: "", alt: "", caption: "", width: 0, height: 0, objectFit: "contain" },
  "core.quote": { text: "", attribution: "" },
  "core.button": { label: "", url: "", variant: "primary" },
  "core.link-list": {
    heading: t("ui.blockDefaults.links"),
    items: [
      { label: t("ui.blockDefaults.linkOne"), url: "/" },
      { label: t("ui.blockDefaults.linkTwo"), url: "/" },
    ],
  },
  "core.divider": {},
  "core.spacer": { height: 40 },
  "core.code": { code: "", language: "" },
  "core.embed": { url: "", caption: "" },
  "core.html": { html: "" },
  "justflows.gallery.grid": { items: [], layout: "grid", columns: 3, lightbox: true },
  "justflows.blog.postList": {
    layout: "grid",
    columns: 3,
    showExcerpt: true,
    showDate: true,
    showFeaturedImage: true,
    postsPerPage: 0,
  },
  "justflows.shop.gallery": {
    layout: "thumbs",
    lightbox: true,
    images: [
      { src: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-03-product-01.jpg", alt: t("ui.blockDefaults.productPhoto1") },
      { src: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-03-product-02.jpg", alt: t("ui.blockDefaults.productPhoto2") },
      { src: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-03-product-03.jpg", alt: t("ui.blockDefaults.productPhoto3") },
      { src: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-03-product-04.jpg", alt: t("ui.blockDefaults.productPhoto4") },
    ],
  },
  "justflows.shop.buy-box": {
    title: "{{title}}",
    price: "{{price}}",
    comparePrice: "{{comparePrice}}",
    description: "{{excerpt}}",
    meta: "SKU {{sku}}",
    attributes: "{{attributes}}",
    cartLabel: t("ui.blockDefaults.addToCart"),
    cartUrl: "/cart",
    shipping: "{{weight}} {{weightUnit}} · {{dimensions}}",
    showRating: false,
    showWishlist: false,
  },
  "justflows.shop.breadcrumbs": {
    current: "{{title}}",
    items: [{ name: t("ui.blockDefaults.shop"), href: "/shop" }],
  },
  "justflows.shop.highlights": {
    heading: t("ui.blockDefaults.highlights"),
    items: [t("ui.blockDefaults.replaceTheseHighlightsWithYourProductFeatures")],
  },
  "justflows.shop.accordion": {
    sections: [
      { name: t("ui.blockDefaults.specifications"), items: ["SKU: {{sku}}", "Price: {{price}}", "Stock: {{stock}}"] },
      { name: t("ui.blockDefaults.shipping"), items: [t("ui.blockDefaults.replaceThisWithYourShippingCopy")] },
    ],
  },
  "justflows.shop.policies": {
    items: [
      { name: t("ui.blockDefaults.freeDelivery"), description: t("ui.blockDefaults.replaceThisWithYourShippingPolicy"), imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce/icons/icon-delivery-light.svg" },
      { name: t("ui.blockDefaults.customerSupport"), description: t("ui.blockDefaults.replaceThisWithHowCustomersCanReachYou"), imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce/icons/icon-chat-light.svg" },
    ],
  },
  "justflows.shop.reviews": {
    heading: t("ui.blockDefaults.customerReviews"),
    average: 0,
    totalCount: 0,
    showHistogram: false,
    items: [],
    writeLabel: t("ui.blockDefaults.writeAReview"),
    writeHref: "#",
  },
  "justflows.shop.related": {
    heading: t("ui.blockDefaults.youMayAlsoLike"),
    layout: "cards",
    items: [
      { name: t("ui.blockDefaults.relatedProduct"), href: "/shop", imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-01-related-product-01.jpg", imageAlt: t("ui.blockDefaults.relatedProduct1"), price: "", color: "" },
      { name: t("ui.blockDefaults.relatedProduct"), href: "/shop", imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-01-related-product-02.jpg", imageAlt: t("ui.blockDefaults.relatedProduct2"), price: "", color: "" },
    ],
  },
  "justflows.shop.product-list": {
    layout: "inline",
    heading: t("ui.blockDefaults.customersAlsoPurchased"),
    headingHidden: false,
    ctaLabel: "",
    ctaHref: "/shop",
    addLabel: t("ui.blockDefaults.addToBag"),
    items: [
      { name: t("ui.blockDefaults.basicTee"), href: "/shop", imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-01-related-product-01.jpg", imageAlt: t("ui.blockDefaults.frontOfMenSBasicTeeInBlack"), price: "$35", color: t("ui.blockDefaults.black"), description: t("ui.blockDefaults.everydayCottonCrewneck"), rating: 5, reviewCount: 38, colors: [{ name: t("ui.blockDefaults.black"), colorBg: "#111827" }, { name: t("ui.blockDefaults.white"), colorBg: "#F9FAFB" }] },
      { name: t("ui.blockDefaults.basicTee"), href: "/shop", imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-01-related-product-02.jpg", imageAlt: t("ui.blockDefaults.frontOfMenSBasicTeeInWhite"), price: "$35", color: t("ui.blockDefaults.aspenWhite"), description: t("ui.blockDefaults.softUnisexFit"), rating: 5, reviewCount: 18, colors: [{ name: t("ui.blockDefaults.aspenWhite"), colorBg: "#F9FAFB" }, { name: t("ui.blockDefaults.black"), colorBg: "#111827" }] },
      { name: t("ui.blockDefaults.basicTee"), href: "/shop", imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-01-related-product-03.jpg", imageAlt: t("ui.blockDefaults.frontOfMenSBasicTeeInDarkGray"), price: "$35", color: t("ui.blockDefaults.charcoal"), description: t("ui.blockDefaults.heavyweightJersey"), rating: 4, reviewCount: 21, colors: [{ name: t("ui.blockDefaults.charcoal"), colorBg: "#4B5563" }, { name: t("ui.blockDefaults.black"), colorBg: "#111827" }] },
      { name: t("ui.blockDefaults.artworkTee"), href: "/shop", imageSrc: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-01-related-product-04.jpg", imageAlt: t("ui.blockDefaults.frontOfMenSArtworkTeeInPeach"), price: "$35", color: t("ui.blockDefaults.isoDots"), description: t("ui.blockDefaults.printedCottonTee"), rating: 5, reviewCount: 24, colors: [{ name: t("ui.blockDefaults.isoDots"), colorBg: "#FED7AA" }, { name: t("ui.blockDefaults.natural"), colorBg: "#FEF3C7" }] },
    ],
  },
  "justflows.shop.detail-shots": {
    heading: t("ui.blockDefaults.theFineDetails"),
    intro: "",
    items: [
      { src: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-04-detail-product-shot-01.jpg", alt: t("ui.blockDefaults.detailPhoto1"), text: t("ui.blockDefaults.replaceThisCaption") },
      { src: "https://tailwindcss.com/plus-assets/img/ecommerce-images/product-page-04-detail-product-shot-02.jpg", alt: t("ui.blockDefaults.detailPhoto2"), text: t("ui.blockDefaults.replaceThisCaption") },
    ],
  },
  "core.grid": { columns: 12, gap: "md", rowHeight: "auto" },
  "core.search": { label: t("ui.blockDefaults.search"), contentType: "", taxonomy: "", term: "", showFilters: false, limit: 20 },
  "core.color-scheme": {
    style: "buttons",
    align: "right",
    showSystem: false,
    animate: true,
    size: "md",
    radius: "pill",
    lightIcon: "☀",
    darkIcon: "☾",
    autoIcon: "◐",
    lightLabel: t("ui.blockDefaults.light"),
    darkLabel: t("ui.blockDefaults.dark"),
    autoLabel: t("ui.blockDefaults.auto"),
  },
  "core.language-switcher": { style: "locale-short", align: "right" },
  "core.auth-links": {
    showLogin: true,
    showRegister: true,
    loginLabel: t("ui.blockDefaults.logIn"),
    registerLabel: t("ui.blockDefaults.register"),
    style: "buttons",
    align: "right",
  },
};

}

export const DEFAULT_PROPS = defaultProps(translateEnglish);

function makeColumn(): BlockNode {
  return { id: newId(), type: "core.column", version: 1, props: {}, children: [] };
}

export function createBlock(type: string, t: Translate = translateEnglish): BlockNode {
  const block: BlockNode = {
    id: newId(),
    type,
    version: 1,
    props: { ...(defaultProps(t)[type] ?? {}) },
  };

  if (type === "core.columns") {
    const cols = (block.props.columns as number) ?? 2;
    block.children = Array.from({ length: cols }, () => makeColumn());
  }

  if (type === "core.section" || type === "core.container" || type === "core.group") {
    block.children = [];
  }

  return block;
}

export function syncColumnCount(block: BlockNode): BlockNode {
  if (block.type !== "core.columns") return block;
  const target = Math.min(4, Math.max(2, (block.props.columns as number) ?? 2));
  const children = [...(block.children ?? [])];

  while (children.length < target) children.push(makeColumn());
  while (children.length > target) children.pop();

  return { ...block, props: { ...block.props, columns: target }, children };
}

export const CATEGORY_LABEL_KEYS: Record<string, string> = {
  sections: "ui.blockCategories.sections",
  layout: "ui.blockCategories.layout",
  content: "ui.blockCategories.content",
  media: "ui.blockCategories.media",
  commerce: "ui.blockCategories.commerce",
  site: "ui.blockCategories.site",
};

export const CATEGORY_ORDER = ["sections", "layout", "content", "media", "commerce", "site"];

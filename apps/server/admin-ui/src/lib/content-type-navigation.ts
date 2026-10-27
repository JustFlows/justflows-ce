// SPDX-License-Identifier: MIT
import type { ContentTypeSettings } from "@justflows/content";

export interface ContentTypeMenu {
  slug: string;
  label: string;
  settings?: Partial<ContentTypeSettings>;
}

export function contentTypeQuickActions(types: ContentTypeMenu[]): ContentTypeMenu[] {
  return types.filter(
    (type) => type.settings?.quickAction ?? (type.slug === "post" || type.slug === "page"),
  );
}

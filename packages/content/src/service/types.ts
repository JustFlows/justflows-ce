export type ContentStatus = "draft" | "scheduled" | "published" | "private" | "archived";

export interface ContentItem {
  id: string;
  siteId: string;
  type: string;
  status: ContentStatus;
  slug: string;
  title: string;
  excerpt?: string | null;
  blocks: BlockDocument;
  fields: Record<string, unknown>;
  authorId?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface BlockDocument {
  version: 1;
  blocks: BlockNode[];
}

export interface BlockNode {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
  children?: BlockNode[];
}

export interface CreateContentInput {
  siteId: string;
  type?: string;
  title: string;
  slug?: string;
  excerpt?: string;
  blocks?: BlockDocument;
  fields?: Record<string, unknown>;
  authorId?: string;
}

export interface UpdateContentInput {
  title?: string;
  slug?: string;
  excerpt?: string;
  blocks?: BlockDocument;
  fields?: Record<string, unknown>;
  status?: ContentStatus;
  expectedVersion?: number;
}

export interface ContentQuery {
  siteId: string;
  type?: string;
  status?: ContentStatus;
  slug?: string;
  authorId?: string;
  limit?: number;
  cursor?: string;
}

export interface ContentPage {
  items: ContentItem[];
  nextCursor?: string;
  total?: number;
}

export interface ContentRevision {
  id: string;
  contentId: string;
  siteId: string;
  title: string;
  blocks: BlockDocument;
  fields: Record<string, unknown>;
  version: number;
  createdAt: string;
  createdBy?: string;
}

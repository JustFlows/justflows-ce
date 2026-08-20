export interface SessionData {
  userId: string;
  siteId: string;
  role: string;
  email: string;
  createdAt: number;
}

export interface SessionOptions {
  secret: string;
  cookieName?: string;
  ttlSeconds?: number;
  secure?: boolean;
}

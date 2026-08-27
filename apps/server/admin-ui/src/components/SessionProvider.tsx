import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initialJson } from "../ssr-data";

export interface SessionInfo {
  id: string;
  email: string;
  role: string;
}

interface SessionValue {
  /** Null before session/:me resolves, or when there is no session at all
   *  (pre-login pages, or the request failed). */
  session: SessionInfo | null;
  loading: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

function isSessionInfo(raw: unknown): raw is SessionInfo {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.email === "string" && typeof value.role === "string";
}

/**
 * The signed-in account's identity and role, for the admin UI to decide what
 * to show — not a security control. Every route this informs still enforces
 * its own role check on the server regardless of what the client renders.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const initial = initialJson<unknown>("/api/auth/me");
  const initialSession = isSessionInfo(initial) ? initial : null;
  const [session, setSession] = useState<SessionInfo | null>(initialSession);
  const [loading, setLoading] = useState(initial === undefined);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => (res.ok ? ((await res.json()) as unknown) : null))
      .then((data) => setSession(isSessionInfo(data) ? data : null))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

/** Convenience for the common case of just needing the role. */
export function useSessionRole(): string | null {
  return useSession().session?.role ?? null;
}

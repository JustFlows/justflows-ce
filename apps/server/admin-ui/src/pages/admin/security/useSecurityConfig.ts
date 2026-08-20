import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EffectiveHeaders,
  SecurityAudit,
  SecurityHeadersConfig,
  SecurityPayload,
} from "./types";

/** Milliseconds to wait after the last keystroke before re-grading a draft. */
const AUDIT_DEBOUNCE_MS = 400;

export type SecurityState = {
  payload: SecurityPayload | null;
  draft: SecurityHeadersConfig | null;
  /** Grade for the draft, which may differ from the saved one. */
  audit: SecurityAudit | null;
  effective: EffectiveHeaders | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  saved: boolean;
  error: string | null;
  setDraft: (updater: (config: SecurityHeadersConfig) => SecurityHeadersConfig) => void;
  replaceDraft: (config: SecurityHeadersConfig) => void;
  discard: () => void;
  save: () => Promise<boolean>;
  resetToDefaults: () => Promise<boolean>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Loads the security configuration, tracks an editable draft of it and keeps a
 * live grade in step with that draft. Every page in the Security section edits
 * the same whole-config document, so they all share this hook.
 */
export function useSecurityConfig(): SecurityState {
  const [payload, setPayload] = useState<SecurityPayload | null>(null);
  const [draft, setDraftState] = useState<SecurityHeadersConfig | null>(null);
  const [audit, setAudit] = useState<SecurityAudit | null>(null);
  const [effective, setEffective] = useState<EffectiveHeaders | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedSnapshot = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/security/headers")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json() as Promise<SecurityPayload>;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setDraftState(clone(data.config));
        setAudit(data.audit);
        setEffective(data.effective);
        savedSnapshot.current = JSON.stringify(data.config);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== savedSnapshot.current,
    [draft],
  );

  // Re-grade the draft server-side so the score on screen always comes from the
  // same rules that will judge the config once it is saved.
  useEffect(() => {
    if (!draft || !dirty) return;
    const timer = setTimeout(() => {
      fetch("/api/security/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: draft }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ audit: SecurityAudit; effective: EffectiveHeaders }>) : null))
        .then((data) => {
          if (!data) return;
          setAudit(data.audit);
          setEffective(data.effective);
        })
        .catch(() => null);
    }, AUDIT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty]);

  const setDraft = useCallback(
    (updater: (config: SecurityHeadersConfig) => SecurityHeadersConfig) => {
      setSaved(false);
      setDraftState((current) => (current ? updater(clone(current)) : current));
    },
    [],
  );

  const replaceDraft = useCallback((config: SecurityHeadersConfig) => {
    setSaved(false);
    setDraftState(clone(config));
  }, []);

  const discard = useCallback(() => {
    if (!payload) return;
    const restored = JSON.parse(savedSnapshot.current) as SecurityHeadersConfig;
    setDraftState(restored);
    setAudit(payload.audit);
    setEffective(payload.effective);
    setError(null);
  }, [payload]);

  const commit = useCallback(
    async (request: () => Promise<Response>) => {
      setError(null);
      setSaving(true);
      try {
        const res = await request();
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          config?: SecurityHeadersConfig;
          audit?: SecurityAudit;
          effective?: EffectiveHeaders;
        };
        if (!res.ok) {
          setError(data.error ?? `Could not save (HTTP ${res.status})`);
          return false;
        }
        if (data.config) {
          savedSnapshot.current = JSON.stringify(data.config);
          setDraftState(clone(data.config));
          setPayload((p) =>
            p
              ? {
                  ...p,
                  config: data.config as SecurityHeadersConfig,
                  audit: data.audit ?? p.audit,
                  effective: data.effective ?? p.effective,
                }
              : p,
          );
        }
        if (data.audit) setAudit(data.audit);
        if (data.effective) setEffective(data.effective);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        return true;
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const save = useCallback(() => {
    if (!draft) return Promise.resolve(false);
    return commit(() =>
      fetch("/api/security/headers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    );
  }, [commit, draft]);

  const resetToDefaults = useCallback(
    () => commit(() => fetch("/api/security/headers/reset", { method: "POST" })),
    [commit],
  );

  return {
    payload,
    draft,
    audit,
    effective,
    loading,
    saving,
    dirty,
    saved,
    error,
    setDraft,
    replaceDraft,
    discard,
    save,
    resetToDefaults,
  };
}

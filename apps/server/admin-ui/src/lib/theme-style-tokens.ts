import { useEffect, useState } from "react";

/** A CSS custom property the active theme exposes for per-block overrides. */
export interface ThemeStyleToken {
  name: string;
  label: string;
  section: string;
  description?: string;
  type: string;
  value: string;
  presets?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface ThemeStyleTokenData {
  tokens: ThemeStyleToken[];
  /** block type → token names to surface as first-class inspector controls. */
  blockControls: Record<string, string[]>;
}

const EMPTY: ThemeStyleTokenData = { tokens: [], blockControls: {} };

// Fetched once per admin session; the reference list is small and rarely changes
// while the builder is open.
let cache: Promise<ThemeStyleTokenData> | null = null;

function load(): Promise<ThemeStyleTokenData> {
  if (!cache) {
    cache = fetch("/api/themes/style-tokens")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d: Partial<ThemeStyleTokenData>) => ({
        tokens: Array.isArray(d.tokens) ? d.tokens : [],
        blockControls:
          d.blockControls && typeof d.blockControls === "object" ? d.blockControls : {},
      }))
      .catch(() => EMPTY);
  }
  return cache;
}

export function useThemeStyleTokens(): ThemeStyleTokenData {
  const [data, setData] = useState<ThemeStyleTokenData>(EMPTY);
  useEffect(() => {
    let alive = true;
    void load().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

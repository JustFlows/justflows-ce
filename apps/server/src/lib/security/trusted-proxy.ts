// SPDX-License-Identifier: MIT

export interface TrustedProxyConfig {
  mode: "disabled" | "bounded" | "wide";
  value: string;
}

/** Classify the configured proxy boundary without accepting unsafe hop counts. */
export function classifyTrustedProxy(raw: string | undefined): TrustedProxyConfig {
  const value = (raw ?? "loopback").trim();
  if (value === "" || value === "false" || value === "0") {
    return { mode: "disabled", value: value || "false" };
  }
  if (value === "true" || /^\d+$/.test(value)) return { mode: "wide", value };
  return { mode: "bounded", value };
}

/**
 * Return the value Express may trust. A hop count trusts a position rather than
 * an address; with paths of different lengths an attacker can occupy that
 * position and choose the client IP used by throttles and audit events.
 */
export function trustedProxyValue(raw: string | undefined): false | string {
  const config = classifyTrustedProxy(raw);
  if (config.mode === "disabled") return false;
  if (config.mode === "wide") {
    /**
     * Older releases accepted these values, and the updater cannot edit a
     * service unit, so refusing to boot would take an updated site offline.
     * The value is still not honoured, and Security Center reports it.
     */
    console.warn(
      `[security] Ignoring TRUST_PROXY=${config.value}: true and hop counts are not accepted. Using loopback; set false or explicit proxy addresses/subnets.`,
    );
    return "loopback";
  }
  return config.value;
}

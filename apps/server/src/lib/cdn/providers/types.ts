// SPDX-License-Identifier: MIT

/** Every CDN a site can connect. Add the id here and an adapter in index.ts. */
export const CDN_PROVIDER_IDS = ["bunny"] as const;

export type CdnProviderId = (typeof CDN_PROVIDER_IDS)[number];

/**
 * One setting a provider needs. Secret fields are encrypted at rest and never
 * sent back to the browser; the admin sees only their last four characters.
 */
export interface CdnFieldSpec {
  id: string;
  label: string;
  hint?: string;
  secret: boolean;
  required: boolean;
  maxLength: number;
  /** Validates a non-empty value. */
  pattern?: RegExp;
}

/** Field values by field id, already decrypted. Server-only. */
export type CdnConfig = Record<string, string>;

export class CdnProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface CdnProviderAdapter {
  id: CdnProviderId;
  label: string;
  docsUrl: string;
  /** Where a site without an account can sign up (may carry a referral code). */
  signupUrl?: string;
  fields: readonly CdnFieldSpec[];
  /** Check that the credentials work. Throws CdnProviderError. */
  verify(config: CdnConfig): Promise<void>;
  /** Drop cached copies under each `https://<host>/*` prefix. Throws CdnProviderError. */
  purgeUrls(config: CdnConfig, urls: readonly string[]): Promise<void>;
  /**
   * Drop everything the configured zone serves. Returns false when the config
   * has no zone to clear. Throws CdnProviderError.
   */
  purgeAll(config: CdnConfig): Promise<boolean>;
}

// SPDX-License-Identifier: MIT

/**
 * Browser side of passkeys (#105): turns the server's JSON options into the
 * ArrayBuffers `navigator.credentials` wants, and the resulting credential back
 * into JSON. Written by hand rather than with `PublicKeyCredential.toJSON()`,
 * which older Safari and Firefox releases do not have.
 */

type Descriptor = { type: "public-key"; id: string; transports?: string[] };

export interface CreationOptionsJson {
  ceremonyId: string;
  publicKey: {
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
    timeout?: number;
    attestation?: AttestationConveyancePreference;
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    excludeCredentials?: Descriptor[];
    extensions?: Record<string, unknown>;
  };
}

export interface RequestOptionsJson {
  ceremonyId: string;
  publicKey: {
    challenge: string;
    rpId: string;
    timeout?: number;
    userVerification?: UserVerificationRequirement;
    allowCredentials?: Descriptor[];
  };
}

export interface CredentialJson {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment?: string | null;
  response: Record<string, string | string[] | null | undefined>;
}

export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const descriptor = (item: Descriptor): PublicKeyCredentialDescriptor => ({
  type: "public-key",
  id: fromBase64Url(item.id),
  ...(item.transports ? { transports: item.transports as AuthenticatorTransport[] } : {}),
});

/** True when this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials);
}

/** True when the browser can offer passkeys in the email field's autofill. */
export async function conditionalMediationAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const check = (window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> }).isConditionalMediationAvailable;
  try {
    return typeof check === "function" ? await check() : false;
  } catch {
    return false;
  }
}

export async function createPasskey(options: CreationOptionsJson): Promise<CredentialJson> {
  const { publicKey } = options;
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...publicKey,
      challenge: fromBase64Url(publicKey.challenge),
      user: { ...publicKey.user, id: fromBase64Url(publicKey.user.id) },
      excludeCredentials: (publicKey.excludeCredentials ?? []).map(descriptor),
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was created", "NotAllowedError");
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = typeof response.getTransports === "function" ? response.getTransports() : [];
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports,
    },
  };
}

export async function getPasskey(options: RequestOptionsJson, signal?: AbortSignal, conditional = false): Promise<CredentialJson> {
  const { publicKey } = options;
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...publicKey,
      challenge: fromBase64Url(publicKey.challenge),
      allowCredentials: (publicKey.allowCredentials ?? []).map(descriptor),
    },
    ...(signal ? { signal } : {}),
    ...(conditional ? { mediation: "conditional" as CredentialMediationRequirement } : {}),
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was chosen", "NotAllowedError");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
  };
}

/**
 * A request this page aborted itself (the autofill request making way for a
 * button press), which deserves no error message. `NotAllowedError` is not
 * included: it is also what the browser throws when a Permissions-Policy or an
 * RP ID mismatch blocks passkeys, and that must be visible.
 */
export function isCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * The passkey offer in the email field's autofill. Only one WebAuthn request
 * may be pending, so `stop()` aborts it and waits until the browser has let go
 * before a button starts its own.
 */
export function conditionalRequest(run: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  const done = run(controller.signal).catch(() => undefined);
  return {
    async stop() {
      controller.abort();
      await done;
    },
  };
}

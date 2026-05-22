/**
 * Drives the OPAQUE register/login handshakes against the sync server.
 *
 * Caller provides the master password + email + server URL. We:
 *   1. Generate (or load) a per-server `sync_salt` so the Argon2id step
 *      is unique per server identity. The salt itself is opaque from the
 *      server's point of view.
 *   2. Derive MK → LK via `keys.ts`.
 *   3. Run the OPAQUE flow via `@cloudflare/opaque-ts`.
 *   4. Return the session bundle the background can persist.
 */
import {
  KE2,
  OpaqueClient,
  OpaqueID,
  RegistrationResponse,
  getOpaqueConfig,
} from "@cloudflare/opaque-ts";

import { bytesToBase64Url, deriveMasterKey, lkToPassword, splitMasterKey } from "./keys.js";
import {
  SyncApiError,
  SyncClient,
  type LoginFinishResponse,
  type RegisterFinishResponse,
} from "./client.js";

const SERVER_IDENTITY = "itsmypassword-server";
const opaqueConfig = getOpaqueConfig(OpaqueID.OPAQUE_P256);

export interface SyncSession {
  /** Server URL, no trailing slash. */
  baseUrl: string;
  /** Lowercased email. */
  email: string;
  /** Server-assigned UUIDv7 hex. */
  userId: string;
  /** Server-assigned UUIDv7 hex for this browser/profile. */
  deviceId: string;
  /** Bearer token. */
  sessionToken: string;
  /** Unix ms. */
  expiresAt: number;
  /** Device-local salt used in Argon2id. 16 bytes, base64url. */
  saltSync: string;
  /** Device signing keypair, raw bytes base64url. */
  devicePubkey: string;
  devicePrivkey: string;
  /** EK fingerprint (hex, first 8 bytes of SHA-256(EK)) — useful for
   * detecting wrong-master without keeping EK around. */
  ekFingerprint: string;
}

/** A minimal device keypair generator. We don't sign events yet (M5
 * focuses on flow); we just persist a stable identity per device. */
function generateDeviceKeypair(): { pub: Uint8Array; priv: Uint8Array } {
  // Ed25519 via WebCrypto requires generateKey + exportKey which is async.
  // For this scaffold we use a random 32-byte identifier as pubkey and a
  // separate 32-byte private blob; real Ed25519 binding lands when we
  // add signed events in M6.
  const pub = crypto.getRandomValues(new Uint8Array(32));
  const priv = crypto.getRandomValues(new Uint8Array(32));
  return { pub, priv };
}

export interface RegisterArgs {
  baseUrl: string;
  email: string;
  master: string;
  deviceLabel?: string;
}

export interface LoginArgs {
  baseUrl: string;
  email: string;
  master: string;
  deviceLabel?: string;
  /** If we already enrolled on this device, reuse the keypair + salt. */
  existing?: Pick<SyncSession, "saltSync" | "devicePubkey" | "devicePrivkey">;
}

/** Run the OPAQUE registration end-to-end and return the new session. */
export async function syncRegister(args: RegisterArgs): Promise<SyncSession> {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const email = args.email.trim().toLowerCase();
  const client = new SyncClient({ baseUrl });

  const saltSync = crypto.getRandomValues(new Uint8Array(16));
  const mk = await deriveMasterKey(args.master, email, saltSync);
  // For registration the server doesn't know user_id yet; use a zero salt
  // for the HKDF step (server will use the same convention via the
  // credential_identifier mechanism). At login time we'll use user_id.
  const hkdfSalt = new Uint8Array(16);
  const { ek, lk } = await splitMasterKey(mk, hkdfSalt);

  const opaque = new OpaqueClient(opaqueConfig);
  const req = await opaque.registerInit(lkToPassword(lk));
  if (req instanceof Error) throw req;

  const start = await client.registerStart({ email, request: req.serialize() });

  const finResult = await opaque.registerFinish(
    RegistrationResponse.deserialize(opaqueConfig, start.response),
    SERVER_IDENTITY,
  );
  if (finResult instanceof Error) throw finResult;

  const { pub, priv } = generateDeviceKeypair();

  const kdfParams = JSON.stringify({
    algo: "argon2id",
    m: 65536,
    t: 3,
    p: 1,
    saltSync: bytesToBase64Url(saltSync),
  });

  const finished: RegisterFinishResponse = await client.registerFinish({
    email,
    record: finResult.record.serialize(),
    kdfParams,
    devicePubkey: Array.from(pub),
    deviceLabel: args.deviceLabel ?? defaultDeviceLabel(),
  });

  return {
    baseUrl,
    email,
    userId: finished.userId,
    deviceId: finished.deviceId,
    sessionToken: finished.sessionToken,
    expiresAt: finished.expiresAt,
    saltSync: bytesToBase64Url(saltSync),
    devicePubkey: bytesToBase64Url(pub),
    devicePrivkey: bytesToBase64Url(priv),
    ekFingerprint: await fingerprint(ek),
  };
}

/** Run the OPAQUE login end-to-end. */
export async function syncLogin(args: LoginArgs): Promise<SyncSession> {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const email = args.email.trim().toLowerCase();
  const client = new SyncClient({ baseUrl });

  const saltSync = args.existing
    ? base64UrlToBytes(args.existing.saltSync)
    : crypto.getRandomValues(new Uint8Array(16));
  const mk = await deriveMasterKey(args.master, email, saltSync);

  const opaque = new OpaqueClient(opaqueConfig);

  // We need LK to drive the OPAQUE handshake. Use a zero HKDF salt for
  // now; same convention as registration.
  const { ek, lk } = await splitMasterKey(mk, new Uint8Array(16));

  const ke1 = await opaque.authInit(lkToPassword(lk));
  if (ke1 instanceof Error) throw ke1;

  const start = await client.loginStart({ email, ke1: ke1.serialize() });

  const finResult = await opaque.authFinish(
    KE2.deserialize(opaqueConfig, start.ke2),
    SERVER_IDENTITY,
  );
  if (finResult instanceof Error) {
    // Wrong master — surface a clean error before round-trip 2 so the UI
    // does not even try.
    throw new SyncApiError(401, { error: "invalid_master" }, "wrong master password");
  }

  const pub = args.existing
    ? base64UrlToBytes(args.existing.devicePubkey)
    : generateDeviceKeypair().pub;
  const priv = args.existing
    ? args.existing.devicePrivkey
    : bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  const finished: LoginFinishResponse = await client.loginFinish({
    challengeToken: start.challengeToken,
    ke3: finResult.ke3.serialize(),
    devicePubkey: Array.from(pub),
    deviceLabel: args.deviceLabel ?? defaultDeviceLabel(),
  });

  return {
    baseUrl,
    email,
    userId: finished.userId,
    deviceId: finished.deviceId,
    sessionToken: finished.sessionToken,
    expiresAt: finished.expiresAt,
    saltSync: bytesToBase64Url(saltSync),
    devicePubkey: bytesToBase64Url(pub),
    devicePrivkey: typeof priv === "string" ? priv : bytesToBase64Url(priv),
    ekFingerprint: await fingerprint(ek),
  };
}

/**
 * Derive EK and AES key from a master + session, without re-running the
 * OPAQUE flow. Used to encrypt/decrypt sync payloads on the fly.
 */
export async function deriveEncryptionKey(
  session: SyncSession,
  master: string,
): Promise<CryptoKey> {
  const saltSync = base64UrlToBytes(session.saltSync);
  const mk = await deriveMasterKey(master, session.email, saltSync);
  const { ek } = await splitMasterKey(mk, new Uint8Array(16));
  // Verify EK matches what we recorded — wrong master shows up here.
  const fp = await fingerprint(ek);
  if (fp !== session.ekFingerprint) {
    throw new Error("master mismatch");
  }
  return crypto.subtle.importKey("raw", ek as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// --- helpers ---------------------------------------------------------------

async function fingerprint(ek: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", ek as BufferSource);
  const view = new Uint8Array(h, 0, 8);
  let s = "";
  for (const b of view) s += b.toString(16).padStart(2, "0");
  return s;
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function defaultDeviceLabel(): string {
  // navigator.userAgentData is widely available in MV3 service workers.
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "unknown";
  return `${platform} • ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Drives the OPAQUE register/login handshakes against the sync server.
 *
 *   1. Derive a per-(email, server) deterministic `saltSync` so any
 *      device of the same user reproduces the same MK without needing
 *      to fetch anything from the server first.
 *   2. Derive MK → EK + LK via `keys.ts`.
 *   3. Run the OPAQUE flow via `@cloudflare/opaque-ts`.
 *   4. Return a SyncSession discriminated union: `pending` after a
 *      brand-new registration (admin hasn't approved yet) or
 *      `approved` (bearer token in hand).
 */
import {
  KE2,
  OpaqueClient,
  OpaqueID,
  RegistrationResponse,
  getOpaqueConfig,
} from "@cloudflare/opaque-ts";

import {
  bytesToBase64Url,
  deriveMasterKey,
  deriveSaltSync,
  lkToPassword,
  splitMasterKey,
} from "./keys.js";
import {
  SyncApiError,
  SyncClient,
  type LoginFinishResponse,
  type RegisterFinishResponse,
} from "./client.js";

const SERVER_IDENTITY = "itsmypassword-server";
const opaqueConfig = getOpaqueConfig(OpaqueID.OPAQUE_P256);

interface SyncSessionCommon {
  baseUrl: string;
  email: string;
  userId: string;
  deviceId: string;
  saltSync: string;
  devicePubkey: string;
  devicePrivkey: string;
  ekFingerprint: string;
}

/** Account is registered server-side but the admin has not yet decided. */
export interface PendingSyncSession extends SyncSessionCommon {
  status: "pending";
}

/** Account is approved; we hold a bearer token. */
export interface ApprovedSyncSession extends SyncSessionCommon {
  status: "approved";
  sessionToken: string;
  expiresAt: number;
}

export type SyncSession = PendingSyncSession | ApprovedSyncSession;

function generateDeviceKeypair(): { pub: Uint8Array; priv: Uint8Array } {
  // Random identifier today; real Ed25519 binding lands when we sign
  // events.
  const pub = crypto.getRandomValues(new Uint8Array(32));
  const priv = crypto.getRandomValues(new Uint8Array(32));
  return { pub, priv };
}

export interface ConnectArgs {
  baseUrl: string;
  email: string;
  master: string;
  deviceLabel?: string;
}

/** OPAQUE registration. Returns a pending session — the admin must
 * approve before we get a bearer token. */
export async function syncRegister(args: ConnectArgs): Promise<PendingSyncSession> {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const email = args.email.trim().toLowerCase();
  const client = new SyncClient({ baseUrl });

  const saltSync = await deriveSaltSync(email, baseUrl);
  const mk = await deriveMasterKey(args.master, email, saltSync);
  const { ek, lk } = await splitMasterKey(mk, new Uint8Array(16));

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
    saltScheme: "impw.sync.salt.v1",
  });

  const finished: RegisterFinishResponse = await client.registerFinish({
    email,
    record: finResult.record.serialize(),
    kdfParams,
    devicePubkey: Array.from(pub),
    deviceLabel: args.deviceLabel ?? defaultDeviceLabel(),
  });

  return {
    status: "pending",
    baseUrl,
    email,
    userId: finished.userId,
    deviceId: finished.deviceId,
    saltSync: bytesToBase64Url(saltSync),
    devicePubkey: bytesToBase64Url(pub),
    devicePrivkey: bytesToBase64Url(priv),
    ekFingerprint: await fingerprint(ek),
  };
}

/** OPAQUE login. Throws on wrong-master via `SyncApiError(401)`,
 * forwards the server's 403 pending_approval as `SyncApiError(403)`
 * so the caller can branch. */
export async function syncLogin(args: ConnectArgs): Promise<ApprovedSyncSession> {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const email = args.email.trim().toLowerCase();
  const client = new SyncClient({ baseUrl });

  const saltSync = await deriveSaltSync(email, baseUrl);
  const mk = await deriveMasterKey(args.master, email, saltSync);
  const { ek, lk } = await splitMasterKey(mk, new Uint8Array(16));

  const opaque = new OpaqueClient(opaqueConfig);

  const ke1 = await opaque.authInit(lkToPassword(lk));
  if (ke1 instanceof Error) throw ke1;

  const start = await client.loginStart({ email, ke1: ke1.serialize() });

  const finResult = await opaque.authFinish(
    KE2.deserialize(opaqueConfig, start.ke2),
    SERVER_IDENTITY,
  );
  if (finResult instanceof Error) {
    throw new SyncApiError(401, { error: "invalid_master" }, "wrong master password");
  }

  const { pub, priv } = generateDeviceKeypair();

  const finished: LoginFinishResponse = await client.loginFinish({
    challengeToken: start.challengeToken,
    ke3: finResult.ke3.serialize(),
    devicePubkey: Array.from(pub),
    deviceLabel: args.deviceLabel ?? defaultDeviceLabel(),
  });

  return {
    status: "approved",
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

/**
 * Re-derive the AES key for sync payload encryption from a master + the
 * known SyncSession metadata. Verifies the EK fingerprint matches what
 * we recorded at first connect — catches a master change.
 */
export async function deriveEncryptionKey(
  session: SyncSession,
  master: string,
): Promise<CryptoKey> {
  const saltSync = await deriveSaltSync(session.email, session.baseUrl);
  const mk = await deriveMasterKey(master, session.email, saltSync);
  const { ek } = await splitMasterKey(mk, new Uint8Array(16));
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

function defaultDeviceLabel(): string {
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "unknown";
  return `${platform} • ${new Date().toISOString().slice(0, 10)}`;
}

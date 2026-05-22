/**
 * Sync runner. Orchestrates the lifecycle of a sync session — connect
 * (login-then-register fallback), poll for admin approval, disconnect —
 * without leaking the master to the rest of the background.
 *
 * Two new behaviours since admin-approval landed:
 *   1. `connect` may return a session whose status is `pending`. The
 *      runner stores it; the popup is responsible for polling.
 *   2. The runner reads the unlocked master from `chrome.storage.session`
 *      via `readMaster()`. Callers no longer have to pass it.
 */
import { SyncApiError, SyncClient } from "../../shared/sync/client.js";
import {
  syncLogin,
  syncRegister,
  type ApprovedSyncSession,
  type PendingSyncSession,
  type SyncSession,
} from "../../shared/sync/auth.js";
import type { SyncSessionView } from "../../shared/messages.js";
import { readMaster } from "../session.js";
import { clearSession, loadSession, saveSession } from "./session-store.js";

/** Surface of the SyncSession returned to UI layers. Strips secrets
 * the popup has no business seeing (devicePrivkey, saltSync, ekFp,
 * sessionToken). */
function toView(session: SyncSession): SyncSessionView {
  return {
    baseUrl: session.baseUrl,
    email: session.email,
    deviceId: session.deviceId,
    userId: session.userId,
    approvalStatus: session.status,
    connectedAt: 0,
    lastSyncAt: null,
  };
}

export interface SyncStatus {
  connected: boolean;
  session: SyncSessionView | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const session = await loadSession();
  if (!session) return { connected: false, session: null };
  return { connected: true, session: toView(session) };
}

/** Probe a server URL via `GET /health` with a short timeout. */
export async function testConnection(
  baseUrl: string,
): Promise<{ reachable: boolean; reason?: string }> {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    return { reachable: false, reason: "invalid_url" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${trimmed}/health`, { signal: controller.signal });
    if (!res.ok) return { reachable: false, reason: `http_${res.status}` };
    const body = (await res.json()) as { status?: string };
    if (body.status !== "ok") return { reachable: false, reason: "unexpected_payload" };
    return { reachable: true };
  } catch (err) {
    const code = err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    return { reachable: false, reason: code };
  } finally {
    clearTimeout(timeout);
  }
}

export class MasterLockedError extends Error {
  constructor() {
    super("master_locked");
    this.name = "MasterLockedError";
  }
}

export interface ConnectResult {
  session: SyncSession;
  /** True when the server already had a matching account and we logged
   * in; false when we registered a fresh pending account. */
  loggedIn: boolean;
}

/**
 * Try OPAQUE login first; on 4xx (other than 429) fall back to register.
 *   - login succeeds → approved session
 *   - login 403 pending_approval → server already has us in pending,
 *     synthesise a pending session locally (we don't have its userId
 *     handy, so we fall through to register/finish which will return
 *     409 already_registered)
 *   - login 4xx → register
 *     - register succeeds → pending session
 *     - register 409 → genuine wrong-master, propagate
 */
export async function connect(args: {
  baseUrl: string;
  email: string;
  deviceLabel?: string;
}): Promise<ConnectResult> {
  const master = await readMaster();
  if (master === null) {
    throw new MasterLockedError();
  }
  const baseUrl = args.baseUrl.trim().replace(/\/+$/, "");

  let loginFailedStatus: number | null = null;
  try {
    const session = await syncLogin({
      baseUrl,
      email: args.email,
      master,
      ...(args.deviceLabel !== undefined ? { deviceLabel: args.deviceLabel } : {}),
    });
    await saveSession(session);
    return { session, loggedIn: true };
  } catch (err) {
    if (err instanceof SyncApiError) {
      if (err.status === 429) throw err;
      // pending_approval: the user account already exists, pending.
      // We can't construct a full session because we don't know the
      // userId / the keypair we'd register here is fresh. Best path:
      // fall through to register/finish which 409s; we then build a
      // pending session manually from what we already have. Simpler:
      // call /auth/opaque/login/start, it told us 200 — but the 403
      // comes at /finish AFTER we already devicePubkey'd. The server's
      // body includes the userId in the pending_approval case (see
      // routes/auth.ts). Use it.
      if (err.status === 403) {
        const body = err.body as { error?: string; userId?: string };
        if (body?.error === "pending_approval" && typeof body.userId === "string") {
          const pending: PendingSyncSession = {
            status: "pending",
            baseUrl,
            email: args.email.trim().toLowerCase(),
            userId: body.userId,
            // No device/keys yet for the pending case from the login leg:
            // we'll receive a real deviceId once approved, via the
            // approval-status poll. Placeholders for now.
            deviceId: "",
            saltSync: "",
            devicePubkey: "",
            devicePrivkey: "",
            ekFingerprint: "",
          };
          await saveSession(pending);
          return { session: pending, loggedIn: true };
        }
      }
      if (err.status >= 400 && err.status < 500) {
        loginFailedStatus = err.status;
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (loginFailedStatus === null) throw new Error("unreachable");

  try {
    const session = await syncRegister({
      baseUrl,
      email: args.email,
      master,
      ...(args.deviceLabel !== undefined ? { deviceLabel: args.deviceLabel } : {}),
    });
    await saveSession(session);
    return { session, loggedIn: false };
  } catch (err) {
    if (err instanceof SyncApiError && err.status === 409) {
      throw new Error("wrong master password");
    }
    throw err;
  }
}

/** Poll /auth/approval-status; on `approved`, upgrade the persisted
 * session to `ApprovedSyncSession` and return the latest status. */
export async function pollApproval(): Promise<
  | { status: "pending" }
  | { status: "approved" }
  | { status: "rejected"; reason?: string }
  | { status: "no_session" }
> {
  const session = await loadSession();
  if (!session) return { status: "no_session" };
  if (session.status === "approved") return { status: "approved" };
  if (!session.userId) return { status: "pending" };

  const client = new SyncClient({ baseUrl: session.baseUrl });
  const r = await client.approvalStatus(session.userId);
  if (r.status === "pending") return { status: "pending" };
  if (r.status === "rejected") {
    return r.reason !== undefined
      ? { status: "rejected", reason: r.reason }
      : { status: "rejected" };
  }
  // approved — server returns a sessionToken bound to a device it
  // created at register/finish. Persist + upgrade.
  if (!r.sessionToken || r.expiresAt === undefined) {
    return { status: "pending" };
  }
  const upgraded: ApprovedSyncSession = {
    ...session,
    status: "approved",
    sessionToken: r.sessionToken,
    expiresAt: r.expiresAt,
  };
  await saveSession(upgraded);
  return { status: "approved" };
}

/** Best-effort server logout + always-on local wipe. */
export async function disconnect(): Promise<void> {
  const session = await loadSession();
  if (session && session.status === "approved") {
    try {
      const client = new SyncClient({
        baseUrl: session.baseUrl,
        sessionToken: session.sessionToken,
      });
      await client.logout();
    } catch {
      /* network errors, expired token, deleted account — local wipe
       * still runs. */
    }
  }
  await clearSession();
}

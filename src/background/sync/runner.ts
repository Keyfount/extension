/**
 * Sync runner. Orchestrates the lifecycle of a sync session (connect,
 * disconnect, status) without leaking the master to the rest of the
 * background.
 *
 * The runner does NOT auto-pull/push yet — that's a follow-up. This
 * module owns:
 *   - persistence of the SyncSession (chrome.storage.local)
 *   - the OPAQUE handshake (try-login-then-register fallback)
 *   - connection probing (GET /health)
 *   - clean disconnect (best-effort POST /auth/logout + local wipe)
 */
import { SyncApiError, SyncClient } from "../../shared/sync/client.js";
import { syncLogin, syncRegister, type SyncSession } from "../../shared/sync/auth.js";
import type { SyncSessionView } from "../../shared/messages.js";
import { clearSession, loadSession, saveSession } from "./session-store.js";

/** Surface of the SyncSession returned to UI layers. Strips secrets
 * (devicePrivkey, saltSync, ekFingerprint) the popup has no business
 * seeing. */
function toView(session: SyncSession, lastSyncAt: number | null): SyncSessionView {
  return {
    baseUrl: session.baseUrl,
    email: session.email,
    deviceId: session.deviceId,
    connectedAt: session.expiresAt - 30 * 24 * 60 * 60 * 1000,
    lastSyncAt,
  };
}

export interface SyncStatus {
  connected: boolean;
  session: SyncSessionView | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const session = await loadSession();
  if (!session) return { connected: false, session: null };
  return { connected: true, session: toView(session, null) };
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

export interface ConnectResult {
  session: SyncSession;
  loggedIn: boolean;
}

/**
 * Connect a device to a server. Tries OPAQUE login first; on failure
 * tries to register. A failure on the login leg is genuinely ambiguous:
 * the server uses RegistrationRecord.createFake() for unknown emails
 * (anti-enumeration), so the client cannot tell "you don't have an
 * account yet" from "you typed the wrong master".
 *
 * The disambiguation lives in the register leg:
 *   - register/finish returns 409 already_registered  → the email DOES
 *     exist, the original login failure was a real wrong-master.
 *   - register/finish returns 200                     → it was a
 *     brand-new account; the user is now enrolled.
 *
 * Anything else on either leg (network error, rate-limit, server bug)
 * bubbles up untouched.
 */
export async function connect(args: {
  baseUrl: string;
  email: string;
  master: string;
  deviceLabel?: string;
}): Promise<ConnectResult> {
  const baseUrl = args.baseUrl.trim().replace(/\/+$/, "");

  let loginFailed = false;
  try {
    const session = await syncLogin({
      baseUrl,
      email: args.email,
      master: args.master,
      ...(args.deviceLabel !== undefined ? { deviceLabel: args.deviceLabel } : {}),
    });
    await saveSession(session);
    return { session, loggedIn: true };
  } catch (err) {
    // Wrong-master surfaces as a synthetic SyncApiError(401) thrown by
    // syncLogin when client.authFinish refuses the KE2. Anything else
    // that ISN'T a 4xx we bubble up — it's a real outage.
    // Pass rate-limit and explicit "already registered" responses through
    // — falling back to register on those would either fail the same way
    // or hammer the limiter further.
    if (err instanceof SyncApiError && err.status === 429) throw err;
    if (err instanceof SyncApiError && err.status >= 400 && err.status < 500) {
      loginFailed = true;
    } else {
      throw err;
    }
  }

  if (!loginFailed) {
    // Unreachable: success returned above. Keeps the TS narrowing happy.
    throw new Error("unreachable");
  }

  try {
    const session = await syncRegister({
      baseUrl,
      email: args.email,
      master: args.master,
      ...(args.deviceLabel !== undefined ? { deviceLabel: args.deviceLabel } : {}),
    });
    await saveSession(session);
    return { session, loggedIn: false };
  } catch (err) {
    // 409 means the email exists on the server — the original login
    // failure was a genuine wrong-master.
    if (err instanceof SyncApiError && err.status === 409) {
      throw new Error("wrong master password");
    }
    throw err;
  }
}

/** Best-effort server logout + always-on local wipe. */
export async function disconnect(): Promise<void> {
  const session = await loadSession();
  if (session) {
    try {
      const client = new SyncClient({
        baseUrl: session.baseUrl,
        sessionToken: session.sessionToken,
      });
      await client.logout();
    } catch {
      // Network errors, expired token, deleted account — none of them
      // should block local disconnect. Wipe regardless.
    }
  }
  await clearSession();
}

export const __testing = { toView };

/**
 * Message contract between the popup (and future content scripts) and the
 * background service worker.
 *
 * Every message goes through `chrome.runtime.sendMessage` with a single
 * discriminated-union payload. Centralising the type here keeps both sides
 * honest about the shape of requests and responses.
 */
import type { AccountEntry, Profile } from "./types.js";

export type Request =
  | { kind: "status" }
  | { kind: "unlock"; master: string }
  | { kind: "unlockWithPin"; pin: string }
  | { kind: "lock" }
  | { kind: "setup"; master: string; defaultProfile?: Profile }
  | { kind: "fingerprint"; master: string }
  | { kind: "generate"; domain: string; email: string; profile?: Profile }
  | { kind: "getProfile"; domain: string }
  | { kind: "setProfile"; domain: string; profile: Profile }
  | { kind: "deleteProfile"; domain: string }
  | { kind: "setDefaultProfile"; profile: Profile }
  | { kind: "setAutoLockMinutes"; minutes: number }
  | { kind: "setPin"; pin: string }
  | { kind: "removePin" }
  | { kind: "getState" }
  | { kind: "wipe" }
  | { kind: "listAccounts"; domain?: string }
  | { kind: "recordAccount"; domain: string; username: string; profile: Profile }
  | { kind: "updateAccountProfile"; domain: string; username: string; profile: Profile }
  | { kind: "renameAccount"; domain: string; oldUsername: string; newUsername: string }
  | { kind: "deleteAccount"; domain: string; username: string }
  | { kind: "setFaviconFallbackEnabled"; enabled: boolean }
  | { kind: "setHistoryEnabled"; enabled: boolean }
  | { kind: "setPendingSave"; domain: string; username: string; profile?: Profile }
  | { kind: "getPendingSave"; domain: string }
  | { kind: "clearPendingSave"; domain: string }
  | { kind: "setClipboardClearSeconds"; seconds: number }
  | { kind: "armClipboardClear"; seconds?: number }
  | { kind: "cancelClipboardClear" }
  | { kind: "setRecentUsername"; domain: string; username: string }
  | { kind: "getRecentUsername"; domain: string }
  // --- server sync ---------------------------------------------------------
  | { kind: "syncStatus" }
  | { kind: "syncTestConnection"; baseUrl: string }
  | { kind: "syncConnect"; baseUrl: string; email: string; deviceLabel?: string }
  | { kind: "syncPollApproval" }
  | { kind: "syncDisconnect" };

// All responses share the same shape on success; we use a small set of
// payload types and let TS pick the right one via the discriminator.
export type Response<T extends Request> = T extends { kind: "syncStatus" }
  ? SyncStatusResponse
  : T extends { kind: "syncTestConnection" }
    ? SyncTestConnectionResponse
    : T extends { kind: "syncConnect" }
      ? SyncConnectResponse
      : T extends { kind: "syncPollApproval" }
        ? SyncPollApprovalResponse
        : T extends { kind: "status" }
          ? StatusResponse
          : T extends { kind: "unlock" | "unlockWithPin" | "setup" }
            ? UnlockResponse
            : T extends { kind: "fingerprint" }
              ? FingerprintResponse
              : T extends { kind: "generate" }
                ? GenerateResponse
                : T extends { kind: "getProfile" }
                  ? GetProfileResponse
                  : T extends { kind: "getState" }
                    ? GetStateResponse
                    : T extends { kind: "listAccounts" }
                      ? ListAccountsResponse
                      : T extends {
                            kind: "recordAccount" | "updateAccountProfile" | "renameAccount";
                          }
                        ? RecordAccountResponse
                        : T extends { kind: "setHistoryEnabled" }
                          ? SetHistoryEnabledResponse
                          : T extends { kind: "getPendingSave" }
                            ? GetPendingSaveResponse
                            : T extends { kind: "getRecentUsername" }
                              ? GetRecentUsernameResponse
                              : OkResponse;

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

export interface StatusResponse {
  ok: true;
  locked: boolean;
  isFirstRun: boolean;
  fingerprint: string | null;
  hasPin: boolean;
}

export interface UnlockResponse {
  ok: true;
  fingerprint: string;
}

export interface FingerprintResponse {
  ok: true;
  fingerprint: string;
}

export interface GenerateResponse {
  ok: true;
  password: string;
}

export interface GetProfileResponse {
  ok: true;
  profile: Profile;
  isOverride: boolean;
}

export interface GetStateResponse {
  ok: true;
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  clipboardClearSeconds: number;
  sites: Record<string, Profile>;
}

export interface ListAccountsResponse {
  ok: true;
  entries: AccountEntry[];
}

export interface RecordAccountResponse {
  ok: true;
  entry: AccountEntry;
}

export interface SetHistoryEnabledResponse {
  ok: true;
  cleared: number;
}

export interface GetPendingSaveResponse {
  ok: true;
  entry: { username: string; profile?: Profile } | null;
}

export interface GetRecentUsernameResponse {
  ok: true;
  username: string | null;
}

/** Subset of SyncSession safe to expose to the popup/options UI. */
export interface SyncSessionView {
  baseUrl: string;
  email: string;
  deviceId: string;
  userId: string;
  approvalStatus: "pending" | "approved";
  connectedAt: number;
  lastSyncAt: number | null;
}

export interface SyncStatusResponse {
  ok: true;
  /** True when a session is persisted (regardless of whether it's been
   * validated against the server since this SW started). */
  connected: boolean;
  session: SyncSessionView | null;
}

export interface SyncTestConnectionResponse {
  ok: true;
  reachable: boolean;
  /** Human-readable reason on failure (timeout, dns, http status, etc.). */
  reason?: string;
}

export interface SyncConnectResponse {
  ok: true;
  session: SyncSessionView;
  /** True when the server already had a matching account and we logged in;
   * false when we registered a fresh account. */
  loggedIn: boolean;
}

export type SyncPollApprovalResponse =
  | { ok: true; status: "pending" }
  | { ok: true; status: "approved"; session: SyncSessionView }
  | { ok: true; status: "rejected"; reason?: string }
  | { ok: true; status: "no_session" };

/** Discriminator for `chrome.runtime.onMessage` callbacks. */
export function isRequest(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

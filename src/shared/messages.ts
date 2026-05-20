/**
 * Message contract between the popup (and future content scripts) and the
 * background service worker.
 *
 * Every message goes through `chrome.runtime.sendMessage` with a single
 * discriminated-union payload. Centralising the type here keeps both sides
 * honest about the shape of requests and responses.
 */
import type { Profile } from "./types.js";

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
  | { kind: "wipe" };

// All responses share the same shape on success; we use a small set of
// payload types and let TS pick the right one via the discriminator.
export type Response<T extends Request> = T extends { kind: "status" }
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
  sites: Record<string, Profile>;
}

/** Discriminator for `chrome.runtime.onMessage` callbacks. */
export function isRequest(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

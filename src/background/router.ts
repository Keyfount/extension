/**
 * Message router for the background service worker.
 *
 * Pure logic, no side effects at import time. The entrypoint module wires
 * `handleRequest` into `chrome.runtime.onMessage`.
 */
import {
  decryptMaster,
  derivePassword,
  encryptMaster,
  fingerprintMaster,
  formatFingerprint,
} from "./crypto/index.js";
import { effectiveProfile, loadState, updateState, wipeAll, type StoredState } from "./storage.js";
import { lock, readMaster, status as sessionStatus, unlock } from "./session.js";
import type {
  ErrorResponse,
  GenerateResponse,
  GetProfileResponse,
  GetStateResponse,
  Request,
  StatusResponse,
  UnlockResponse,
  OkResponse,
  FingerprintResponse,
} from "../shared/messages.js";
import { DEFAULT_RANDOM_PROFILE, type Profile } from "../shared/types.js";

type AnyResponse =
  | OkResponse
  | ErrorResponse
  | StatusResponse
  | UnlockResponse
  | FingerprintResponse
  | GenerateResponse
  | GetProfileResponse
  | GetStateResponse;

export async function handleRequest(request: Request): Promise<AnyResponse> {
  try {
    switch (request.kind) {
      case "status":
        return await handleStatus();
      case "setup":
        return await handleSetup(request.master, request.defaultProfile);
      case "unlock":
        return await handleUnlock(request.master);
      case "unlockWithPin":
        return await handleUnlockWithPin(request.pin);
      case "lock":
        await lock();
        return { ok: true };
      case "fingerprint":
        return await handleFingerprint(request.master);
      case "generate":
        return await handleGenerate(request.domain, request.email, request.profile);
      case "getProfile":
        return await handleGetProfile(request.domain);
      case "setProfile":
        await handleSetProfile(request.domain, request.profile);
        return { ok: true };
      case "deleteProfile":
        await handleDeleteProfile(request.domain);
        return { ok: true };
      case "setDefaultProfile":
        await updateState((s) => ({ ...s, defaultProfile: request.profile }));
        return { ok: true };
      case "setAutoLockMinutes":
        if (
          !Number.isInteger(request.minutes) ||
          request.minutes < 0 ||
          request.minutes > 24 * 60
        ) {
          return { ok: false, error: "autoLockMinutes must be an integer between 0 and 1440" };
        }
        await updateState((s) => ({ ...s, autoLockMinutes: request.minutes }));
        return { ok: true };
      case "setPin":
        return await handleSetPin(request.pin);
      case "removePin":
        await updateState((s) => {
          const next = { ...s };
          delete next.pin;
          return next;
        });
        return { ok: true };
      case "getState":
        return await handleGetState();
      case "wipe":
        await wipeAll();
        await lock();
        return { ok: true };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleStatus(): Promise<StatusResponse> {
  const state = await loadState();
  const ses = await sessionStatus();
  return {
    ok: true,
    locked: ses.locked,
    isFirstRun: state.fingerprint === undefined,
    fingerprint: state.fingerprint ?? null,
  };
}

async function handleSetup(
  master: string,
  defaultProfile?: Profile,
): Promise<UnlockResponse | ErrorResponse> {
  if (!master || master.length < 8) {
    return { ok: false, error: "master password must be at least 8 characters" };
  }
  const fingerprintBytes = await fingerprintMaster(master);
  const fingerprint = formatFingerprint(fingerprintBytes);

  await updateState((state) => ({
    ...state,
    fingerprint,
    defaultProfile: defaultProfile ?? state.defaultProfile,
  }));

  const state = await loadState();
  await unlock(master, state.autoLockMinutes);
  return { ok: true, fingerprint };
}

async function handleUnlock(master: string): Promise<UnlockResponse | ErrorResponse> {
  const state = await loadState();
  if (state.fingerprint === undefined) {
    return { ok: false, error: "extension has not been set up" };
  }
  const candidate = formatFingerprint(await fingerprintMaster(master));
  if (candidate !== state.fingerprint) {
    return { ok: false, error: "incorrect master password" };
  }
  await unlock(master, state.autoLockMinutes);
  return { ok: true, fingerprint: candidate };
}

async function handleFingerprint(master: string): Promise<FingerprintResponse> {
  const fp = formatFingerprint(await fingerprintMaster(master));
  return { ok: true, fingerprint: fp };
}

async function handleGenerate(
  domain: string,
  email: string,
  profile?: Profile,
): Promise<GenerateResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) {
    return { ok: false, error: "locked" };
  }
  const state = await loadState();
  const effective = profile ?? effectiveProfile(state, domain);
  const password = await derivePassword({
    inputs: { master, domain, email },
    profile: effective,
  });
  return { ok: true, password };
}

async function handleGetProfile(domain: string): Promise<GetProfileResponse> {
  const state = await loadState();
  const isOverride = state.sites[domain] !== undefined;
  return {
    ok: true,
    profile: state.sites[domain] ?? state.defaultProfile,
    isOverride,
  };
}

async function handleSetProfile(domain: string, profile: Profile): Promise<void> {
  await updateState((state) => ({
    ...state,
    sites: { ...state.sites, [domain]: profile },
  }));
}

async function handleDeleteProfile(domain: string): Promise<void> {
  await updateState((state) => {
    const sites = { ...state.sites };
    delete sites[domain];
    return { ...state, sites };
  });
}

async function handleUnlockWithPin(pin: string): Promise<UnlockResponse | ErrorResponse> {
  const state = await loadState();
  if (state.pin === undefined || state.fingerprint === undefined) {
    return { ok: false, error: "PIN mode is not enabled" };
  }
  const master = await decryptMaster(state.pin, pin);
  if (master === null) {
    return { ok: false, error: "incorrect PIN" };
  }
  await unlock(master, state.autoLockMinutes);
  return { ok: true, fingerprint: state.fingerprint };
}

async function handleSetPin(pin: string): Promise<OkResponse | ErrorResponse> {
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, error: "PIN must be 4 to 6 digits" };
  }
  const master = await readMaster();
  if (master === null) {
    return { ok: false, error: "session must be unlocked to set a PIN" };
  }
  const blob = await encryptMaster(master, pin);
  await updateState((s) => ({ ...s, pin: blob }));
  return { ok: true };
}

async function handleGetState(): Promise<GetStateResponse> {
  const state: StoredState = await loadState();
  return {
    ok: true,
    defaultProfile: state.defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    autoLockMinutes: state.autoLockMinutes,
    hasPin: state.pin !== undefined,
    sites: state.sites,
  };
}

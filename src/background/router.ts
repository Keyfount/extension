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
import {
  deleteAccount,
  listAccounts,
  recordAccount,
  wipeAccounts,
} from "./accounts.js";
import { effectiveProfile, loadState, updateState, wipeAll, type StoredState } from "./storage.js";
import { lock, readMaster, status as sessionStatus, unlock } from "./session.js";
import type {
  ErrorResponse,
  FingerprintResponse,
  GenerateResponse,
  GetProfileResponse,
  GetStateResponse,
  ListAccountsResponse,
  OkResponse,
  RecordAccountResponse,
  Request,
  SetHistoryEnabledResponse,
  StatusResponse,
  UnlockResponse,
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
  | GetStateResponse
  | ListAccountsResponse
  | RecordAccountResponse
  | SetHistoryEnabledResponse;

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
      case "listAccounts":
        return await handleListAccounts(request.domain);
      case "recordAccount":
        return await handleRecordAccount(request.domain, request.username);
      case "deleteAccount":
        await handleDeleteAccount(request.domain, request.username);
        return { ok: true };
      case "setHistoryEnabled":
        return await handleSetHistoryEnabled(request.enabled);
      case "wipe":
        await wipeAll();
        await wipeAccounts();
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
    hasPin: state.pin !== undefined,
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
    historyEnabled: state.historyEnabled,
    sites: state.sites,
  };
}

async function handleListAccounts(
  domain: string | undefined,
): Promise<ListAccountsResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const entries = await listAccounts(master, domain);
  return { ok: true, entries };
}

async function handleRecordAccount(
  domain: string,
  username: string,
): Promise<RecordAccountResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const state = await loadState();
  if (!state.historyEnabled) return { ok: false, error: "history disabled" };
  const trimmed = username.trim();
  if (trimmed.length === 0) return { ok: false, error: "username required" };
  if (domain.length === 0) return { ok: false, error: "domain required" };
  const entry = await recordAccount(master, domain, trimmed);
  return { ok: true, entry };
}

async function handleDeleteAccount(domain: string, username: string): Promise<void> {
  const master = await readMaster();
  if (master === null) return;
  await deleteAccount(master, domain, username);
}

async function handleSetHistoryEnabled(
  enabled: boolean,
): Promise<SetHistoryEnabledResponse | ErrorResponse> {
  let cleared = 0;
  if (!enabled) cleared = await wipeAccounts();
  await updateState((s) => ({ ...s, historyEnabled: enabled }));
  return { ok: true, cleared };
}

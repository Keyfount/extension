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
  clearActiveProfile,
  createProfile,
  deleteProfile,
  getActiveProfileId,
  listProfiles,
  setActiveProfile,
  touchActiveProfile,
  updateProfileFingerprint,
  wipeAllProfiles,
} from "./profiles.js";
import {
  deleteAccount,
  listAccounts,
  recordAccount,
  renameAccount,
  updateAccountProfile,
  wipeAccounts,
  type ProfileFallback,
} from "./accounts.js";
import { clearPendingSave, getPendingSave, setPendingSave } from "./pending.js";
import { getRecentUsername, setRecentUsername } from "./recent-username.js";
import { armClipboardClear, cancelClipboardClear } from "./clipboard.js";
import {
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  SCHEMA_VERSION,
  effectiveProfile,
  loadBootManifest,
  loadState,
  saveStateFor,
  updateState,
  type StoredState,
} from "./storage.js";
import { lock, readMaster, status as sessionStatus, unlock } from "./session.js";
import {
  connect as syncConnect,
  disconnect as syncDisconnect,
  getSyncStatus,
  MasterLockedError,
  pollApproval as syncPoll,
  testConnection,
} from "./sync/runner.js";
import {
  clearLastSyncMap,
  getAllLastSyncedAt,
  getLastSyncedAt,
  pullEvents as enginePull,
  pushAllAccounts as enginePushAll,
  syncAccountChange,
} from "./sync/engine.js";
import type {
  ErrorResponse,
  FingerprintResponse,
  GenerateResponse,
  GetAccountSyncInfoResponse,
  GetSyncMapResponse,
  GetPendingSaveResponse,
  GetProfileResponse,
  GetRecentUsernameResponse,
  GetStateResponse,
  ListAccountsResponse,
  ListVaultsResponse,
  OkResponse,
  RecordAccountResponse,
  Request,
  SetHistoryEnabledResponse,
  StatusResponse,
  SyncConnectResponse,
  SyncPollApprovalResponse,
  SyncPullResponse,
  SyncPushAllResponse,
  SyncStatusResponse,
  SyncTestConnectionResponse,
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
  | SetHistoryEnabledResponse
  | GetPendingSaveResponse
  | GetRecentUsernameResponse
  | SyncStatusResponse
  | SyncTestConnectionResponse
  | SyncConnectResponse
  | SyncPollApprovalResponse
  | GetAccountSyncInfoResponse
  | GetSyncMapResponse
  | SyncPullResponse
  | SyncPushAllResponse
  | ListVaultsResponse;

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
        return await handleRecordAccount(request.domain, request.username, request.profile);
      case "updateAccountProfile":
        return await handleUpdateAccountProfile(request.domain, request.username, request.profile);
      case "renameAccount":
        return await handleRenameAccount(request.domain, request.oldUsername, request.newUsername);
      case "deleteAccount":
        await handleDeleteAccount(request.domain, request.username);
        return { ok: true };
      case "setHistoryEnabled":
        return await handleSetHistoryEnabled(request.enabled);
      case "setFaviconFallbackEnabled":
        await updateState((s) => ({ ...s, faviconFallbackEnabled: request.enabled }));
        return { ok: true };
      case "setPendingSave":
        await setPendingSave(request.domain, request.username, request.profile);
        return { ok: true };
      case "getPendingSave": {
        const entry = await getPendingSave(request.domain);
        return { ok: true, entry };
      }
      case "clearPendingSave":
        await clearPendingSave(request.domain);
        return { ok: true };
      case "setClipboardClearSeconds": {
        const value = request.seconds;
        if (!Number.isFinite(value) || value < 0 || value > 600) {
          return {
            ok: false,
            error: "clipboardClearSeconds must be an integer between 0 and 600",
          };
        }
        await updateState((s) => ({ ...s, clipboardClearSeconds: Math.round(value) }));
        return { ok: true };
      }
      case "armClipboardClear": {
        let seconds = request.seconds;
        if (seconds === undefined) {
          const s = await loadState();
          seconds = s.clipboardClearSeconds;
        }
        await armClipboardClear(seconds);
        return { ok: true };
      }
      case "cancelClipboardClear":
        await cancelClipboardClear();
        return { ok: true };
      case "setRecentUsername":
        await setRecentUsername(request.domain, request.username);
        return { ok: true };
      case "getRecentUsername": {
        const username = await getRecentUsername(request.domain);
        return { ok: true, username };
      }
      case "wipe":
        await lock();
        await wipeAllProfiles();
        return { ok: true };
      case "listVaults": {
        const vaults = await listProfiles();
        const activeId = await getActiveProfileId();
        return { ok: true, activeId, vaults };
      }
      case "switchVault": {
        await lock();
        await chrome.storage.session.clear();
        await setActiveProfile(request.id);
        return { ok: true };
      }
      case "deleteVault": {
        const active = await getActiveProfileId();
        if (active === request.id) {
          await lock();
          await chrome.storage.session.clear();
        }
        await deleteProfile(request.id);
        return { ok: true };
      }
      case "startNewVault":
        await lock();
        await chrome.storage.session.clear();
        await clearActiveProfile();
        return { ok: true };
      case "syncStatus": {
        const status = await getSyncStatus();
        return { ok: true, connected: status.connected, session: status.session };
      }
      case "syncTestConnection": {
        const r = await testConnection(request.baseUrl);
        return r.reason !== undefined
          ? { ok: true, reachable: r.reachable, reason: r.reason }
          : { ok: true, reachable: r.reachable };
      }
      case "syncConnect": {
        try {
          const result = await syncConnect({
            baseUrl: request.baseUrl,
            email: request.email,
            ...(request.deviceLabel !== undefined ? { deviceLabel: request.deviceLabel } : {}),
          });
          const status = await getSyncStatus();
          if (!status.session) {
            return { ok: false, error: "sync_persist_failed" };
          }
          return { ok: true, session: status.session, loggedIn: result.loggedIn };
        } catch (err) {
          if (err instanceof MasterLockedError) {
            return { ok: false, error: "locked" };
          }
          throw err;
        }
      }
      case "syncPollApproval": {
        const r = await syncPoll();
        if (r.status === "approved") {
          const s = await getSyncStatus();
          if (!s.session) return { ok: true, status: "no_session" };
          return { ok: true, status: "approved", session: s.session };
        }
        if (r.status === "rejected") {
          return r.reason !== undefined
            ? { ok: true, status: "rejected", reason: r.reason }
            : { ok: true, status: "rejected" };
        }
        return { ok: true, status: r.status };
      }
      case "syncDisconnect":
        await syncDisconnect();
        await clearLastSyncMap();
        return { ok: true };
      case "getAccountSyncInfo": {
        const lastSyncedAt = await getLastSyncedAt(request.domain, request.username);
        return { ok: true, lastSyncedAt };
      }
      case "getSyncMap": {
        const map = await getAllLastSyncedAt();
        return { ok: true, map };
      }
      case "syncPull": {
        const r = await enginePull();
        if (r === null) {
          return { ok: true, applied: null, skipped: null, cursor: null };
        }
        return { ok: true, applied: r.applied, skipped: r.skipped, cursor: r.cursor };
      }
      case "syncPushAll": {
        const r = await enginePushAll();
        if (r === null) {
          return { ok: true, pushed: null, failed: null };
        }
        return { ok: true, pushed: r.pushed, failed: r.failed };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleStatus(): Promise<StatusResponse> {
  const activeId = await getActiveProfileId();
  if (activeId === null) {
    return {
      ok: true,
      locked: true,
      isFirstRun: true,
      fingerprint: null,
      hasPin: false,
    };
  }
  // Status is rendered before the unlock screen, so we can't decrypt the
  // state here — only the plaintext boot manifest is available.
  const manifest = await loadBootManifest();
  const ses = await sessionStatus();
  return {
    ok: true,
    locked: ses.locked,
    isFirstRun: manifest.fingerprint === undefined,
    fingerprint: manifest.fingerprint ?? null,
    hasPin: manifest.pin !== undefined,
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

  // Setup either populates the active (empty) profile or creates a fresh
  // one. Both paths converge on saving the StoredState with the fingerprint
  // and unlocking the session. Setup runs *before* unlock, so we can't read
  // any pre-existing encrypted state — but a fresh profile has nothing
  // encrypted to read, and the "already set up" guard only needs the
  // plaintext boot manifest.
  const activeId = await getActiveProfileId();
  let targetId: string;
  if (activeId === null) {
    const created = await createProfile(fingerprint);
    targetId = created.id;
  } else {
    const existing = await loadBootManifest();
    if (existing.fingerprint !== undefined) {
      // The active profile already has a master — refuse to overwrite. The
      // caller should have routed to "create new profile" instead.
      return { ok: false, error: "profile already set up" };
    }
    targetId = activeId;
    await updateProfileFingerprint(targetId, fingerprint);
  }

  // A brand-new profile has no encrypted state to read; start from defaults.
  const baseManifest = await loadBootManifest();
  const nextState: StoredState = {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    autoLockMinutes: baseManifest.autoLockMinutes,
    historyEnabled: false,
    faviconFallbackEnabled: true,
    clipboardClearSeconds: DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    fingerprint,
    sites: {},
  };
  await saveStateFor(targetId, nextState, master);

  await unlock(master, nextState.autoLockMinutes);
  return { ok: true, fingerprint };
}

async function handleUnlock(master: string): Promise<UnlockResponse | ErrorResponse> {
  // Locked-vault path: the boot manifest carries the fingerprint and
  // autoLockMinutes without needing the master.
  const manifest = await loadBootManifest();
  if (manifest.fingerprint === undefined) {
    return { ok: false, error: "extension has not been set up" };
  }
  const candidate = formatFingerprint(await fingerprintMaster(master));
  if (candidate !== manifest.fingerprint) {
    return { ok: false, error: "incorrect master password" };
  }
  await unlock(master, manifest.autoLockMinutes);
  await touchActiveProfile();
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
  // Locked-vault path: the boot manifest carries the PIN blob.
  const manifest = await loadBootManifest();
  if (manifest.pin === undefined || manifest.fingerprint === undefined) {
    return { ok: false, error: "PIN mode is not enabled" };
  }
  const master = await decryptMaster(manifest.pin, pin);
  if (master === null) {
    return { ok: false, error: "incorrect PIN" };
  }
  await unlock(master, manifest.autoLockMinutes);
  return { ok: true, fingerprint: manifest.fingerprint };
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
    faviconFallbackEnabled: state.faviconFallbackEnabled,
    clipboardClearSeconds: state.clipboardClearSeconds,
    sites: state.sites,
  };
}

function fallbackFor(state: StoredState): ProfileFallback {
  return (domain: string) => effectiveProfile(state, domain);
}

async function handleListAccounts(
  domain: string | undefined,
): Promise<ListAccountsResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const state = await loadState();
  const entries = await listAccounts(master, domain, fallbackFor(state));
  return { ok: true, entries };
}

async function handleRecordAccount(
  domain: string,
  username: string,
  profile: Profile,
): Promise<RecordAccountResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const state = await loadState();
  if (!state.historyEnabled) return { ok: false, error: "history disabled" };
  const trimmed = username.trim();
  if (trimmed.length === 0) return { ok: false, error: "username required" };
  if (domain.length === 0) return { ok: false, error: "domain required" };
  const entry = await recordAccount(master, domain, trimmed, profile, fallbackFor(state));
  void syncAccountChange({ kind: "upsert", entry, domain, username: trimmed });
  return { ok: true, entry };
}

async function handleUpdateAccountProfile(
  domain: string,
  username: string,
  profile: Profile,
): Promise<RecordAccountResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const state = await loadState();
  const entry = await updateAccountProfile(master, domain, username, profile, fallbackFor(state));
  if (entry === null) return { ok: false, error: "account not found" };
  void syncAccountChange({ kind: "upsert", entry, domain, username });
  return { ok: true, entry };
}

async function handleRenameAccount(
  domain: string,
  oldUsername: string,
  newUsername: string,
): Promise<RecordAccountResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const trimmed = newUsername.trim();
  if (trimmed.length === 0) return { ok: false, error: "username required" };
  const state = await loadState();
  const result = await renameAccount(master, domain, oldUsername, trimmed, fallbackFor(state));
  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === "exists" ? "username already exists" : "account not found",
    };
  }
  void syncAccountChange({
    kind: "rename",
    entry: result.entry,
    domain,
    username: trimmed,
    oldUsername,
  });
  return { ok: true, entry: result.entry };
}

async function handleDeleteAccount(domain: string, username: string): Promise<void> {
  const master = await readMaster();
  if (master === null) return;
  const state = await loadState();
  await deleteAccount(master, domain, username, fallbackFor(state));
  void syncAccountChange({ kind: "delete", domain, username });
}

async function handleSetHistoryEnabled(
  enabled: boolean,
): Promise<SetHistoryEnabledResponse | ErrorResponse> {
  let cleared = 0;
  if (!enabled) {
    cleared = await wipeAccounts();
    // Disabling history kills the rationale for sync — there's nothing
    // left to push or pull. We disconnect (best-effort) and wipe the
    // last-sync map so a future reactivation starts clean.
    await syncDisconnect();
    await clearLastSyncMap();
  }
  await updateState((s) => ({ ...s, historyEnabled: enabled }));
  return { ok: true, cleared };
}

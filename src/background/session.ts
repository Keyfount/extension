/**
 * Session state: the unlocked master password.
 *
 * The master lives in `chrome.storage.session`, which is in-memory and is
 * wiped when the browser is closed. Crucially, MV3 service workers can sleep
 * and respawn; in-memory globals are lost across restarts but
 * `chrome.storage.session` is not. This is what lets the unlock survive a
 * 30-second service-worker idle nap.
 *
 * Access is restricted to TRUSTED_CONTEXTS so content scripts cannot read the
 * master via the storage API.
 */
const SESSION_KEY = "session.v1";
const ALARM_NAME = "keyfount:auto-lock";

interface SessionPayload {
  master: string;
  unlockedAt: number;
  autoLockMinutes: number;
}

/**
 * Configure `chrome.storage.session` so the content script can never read
 * it. Idempotent — safe to call from the service worker init path.
 */
export async function hardenSessionStorage(): Promise<void> {
  // `setAccessLevel` is MV3-only; guard for older type packages.
  const session = chrome.storage.session as typeof chrome.storage.session & {
    setAccessLevel?: (cfg: {
      accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS";
    }) => Promise<void>;
  };
  if (typeof session.setAccessLevel === "function") {
    await session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
}

/** Store the master and arm the auto-lock alarm. */
export async function unlock(master: string, autoLockMinutes: number): Promise<void> {
  const payload: SessionPayload = {
    master,
    unlockedAt: Date.now(),
    autoLockMinutes,
  };
  await chrome.storage.session.set({ [SESSION_KEY]: payload });
  await scheduleAutoLock(autoLockMinutes);
}

/** Wipe the master and clear the alarm. */
export async function lock(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms.clear(ALARM_NAME);
}

/** Return the current master, or `null` if the session is locked. */
export async function readMaster(): Promise<string | null> {
  const { [SESSION_KEY]: raw } = await chrome.storage.session.get(SESSION_KEY);
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as SessionPayload;
  if (typeof payload.master !== "string" || payload.master.length === 0) return null;
  return payload.master;
}

export interface SessionStatus {
  locked: boolean;
  unlockedAt: number | null;
}

export async function status(): Promise<SessionStatus> {
  const { [SESSION_KEY]: raw } = await chrome.storage.session.get(SESSION_KEY);
  if (!raw || typeof raw !== "object") return { locked: true, unlockedAt: null };
  const payload = raw as SessionPayload;
  return { locked: false, unlockedAt: payload.unlockedAt ?? null };
}

async function scheduleAutoLock(autoLockMinutes: number): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  if (autoLockMinutes > 0) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: autoLockMinutes });
  }
}

/** Register the alarm listener that wipes the session on timeout. */
export function registerAutoLockHandler(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      void lock();
    }
  });
}

/**
 * Clipboard auto-clear scheduler.
 *
 * The UI never wipes the clipboard itself — it asks the background to
 * arm an alarm via `armClipboardClear`, and the background fires a
 * `clipboard:clear` message back to whatever extension page is open so
 * that page (running in DOM context) can perform the write. Service
 * workers don't have `navigator.clipboard`, hence the round trip.
 *
 * Only one timer is active at a time; arming overrides any previous
 * pending clear. Cancelling clears the alarm without writing.
 */
const ALARM_NAME = "keyfount:clipboard-clear";

let currentToken: string | null = null;

function nextToken(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Arm a clipboard wipe in `seconds`. A `seconds` of 0 (or less) cancels
 * any pending clear without writing. The returned token identifies the
 * scheduled wipe; callers can compare it to the token broadcast by the
 * alarm to ignore stale events.
 */
export async function armClipboardClear(seconds: number): Promise<string | null> {
  await chrome.alarms.clear(ALARM_NAME);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    currentToken = null;
    return null;
  }
  // chrome.alarms expects minutes; floor to milliseconds via `when`.
  const when = Date.now() + Math.max(1000, Math.round(seconds * 1000));
  await chrome.alarms.create(ALARM_NAME, { when });
  currentToken = nextToken();
  return currentToken;
}

export async function cancelClipboardClear(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  currentToken = null;
}

/**
 * Register the alarm listener. The listener broadcasts a runtime message
 * so any open extension page (popup, options) can wipe the clipboard from
 * a DOM context where `navigator.clipboard` is available.
 */
export function registerClipboardClearHandler(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    const token = currentToken;
    currentToken = null;
    chrome.runtime.sendMessage({ kind: "clipboard:clear", token }).catch(() => {
      /* no listeners — nothing to clear from the worker side anyway */
    });
  });
}

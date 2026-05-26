/**
 * Periodic background pull.
 *
 * The popup already runs `enginePull()` on every open (see
 * popup/App.tsx). That covers the case where the user explicitly
 * checks the extension. But if a desktop or another browser pushes a
 * mutation while the popup is closed, the user wouldn't see it until
 * the next manual open — which defeats the "cross-device sync just
 * works" expectation.
 *
 * `chrome.alarms` keeps a single periodic alarm alive. When it fires,
 * the service worker wakes up, runs `enginePull()` once, and goes
 * back to sleep — total wake time ~100 ms with no traffic, ~1 s
 * with events to apply. The alarm is fire-and-forget: it stops
 * itself silently if no sync session is configured, so a user who
 * never enabled sync pays zero cost.
 *
 * Five minutes is the lowest realistic interval on MV3 (the OS may
 * round small intervals up to 1 min when the device is idle). It
 * matches the "felt latency" most users expect from a password
 * manager — anything shorter just burns battery for no UX gain.
 */
import { pullEvents } from "./engine.js";

const ALARM_NAME = "keyfount.sync.pull";
const PERIOD_MINUTES = 5;

/**
 * Ensure the alarm is scheduled. Idempotent — chrome.alarms.create
 * replaces any existing alarm with the same name, so calling this on
 * every service worker startup is safe.
 */
export async function scheduleSyncPoll(): Promise<void> {
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: PERIOD_MINUTES,
    periodInMinutes: PERIOD_MINUTES,
  });
}

/**
 * Register the alarm listener. Called once at SW startup. We swallow
 * every error from `pullEvents` because:
 *   - `pullEvents` already swallows non-session/offline/decrypt
 *     cases and returns `null`
 *   - even a thrown error here would just be logged by Chrome with
 *     no actionable feedback for the user; locked vaults legitimately
 *     fail the master read and we don't want to spam DevTools
 */
export function registerSyncPollHandler(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void pullEvents().catch(() => {
      /* offline / locked / no session — silent */
    });
  });
}

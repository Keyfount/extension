/**
 * Popup-side clipboard helper.
 *
 * Writes to the clipboard via the DOM API (only available inside an
 * extension page, not the service worker) and asks the background to
 * arm a clipboard-clear alarm using the user-configured delay. The
 * background then sends back a `clipboard:clear` message which the
 * popup-side listener wipes the clipboard from this same DOM context.
 */
import { send } from "./api.js";

export async function copyWithAutoClear(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  try {
    await send({ kind: "armClipboardClear" });
  } catch {
    /* swallowed — auto-clear is a nicety */
  }
}

let listenerInstalled = false;

/**
 * Install a runtime-message listener that wipes the clipboard when the
 * background fires the clear alarm. Idempotent.
 */
export function installClipboardClearListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message !== null &&
      typeof message === "object" &&
      "kind" in message &&
      (message as { kind: unknown }).kind === "clipboard:clear"
    ) {
      void navigator.clipboard.writeText("").catch(() => {
        /* clipboard API may be unavailable if the popup lost focus */
      });
    }
    return false;
  });
}

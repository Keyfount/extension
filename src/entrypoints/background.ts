/**
 * Background service worker entrypoint.
 *
 * Wires the message router to chrome.runtime.onMessage, registers the
 * auto-lock and clipboard-clear alarm handlers, and creates the context
 * menus that let the user fire Keyfount from a right-click. All
 * logic lives in `../background/*` so it stays testable without
 * instantiating a chrome runtime.
 */
import { defineBackground } from "wxt/utils/define-background";
import { handleRequest } from "../background/router.js";
import { hardenSessionStorage, registerAutoLockHandler } from "../background/session.js";
import { registerClipboardClearHandler } from "../background/clipboard.js";
import { registerContextMenus } from "../background/context-menus.js";
import { isRequest } from "../shared/messages.js";

export default defineBackground(() => {
  void hardenSessionStorage();
  registerAutoLockHandler();
  registerClipboardClearHandler();
  registerContextMenus();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRequest(message)) {
      sendResponse({ ok: false, error: "invalid request" });
      return false;
    }
    // Returning true keeps the message channel open for the async response.
    handleRequest(message).then(sendResponse, (error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  });
});

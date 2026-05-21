/**
 * Content script entrypoint.
 *
 * Scans the page for password fields, attaches a floating badge to each, and
 * opens the panel automatically when the user focuses the field. Crypto and
 * the master password stay inside the background service worker.
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { attachBadge, type BadgeController } from "../content/Badge.js";
import { findPasswordFields } from "../content/detect.js";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",

  main() {
    if (window === window.top && window.location.protocol === "chrome:") return;

    const badges = new WeakMap<HTMLInputElement, BadgeController>();

    const openHandler = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const controller = badges.get(target);
      if (controller !== undefined) controller.open();
    };

    // Close on Tab — leaving the field via keyboard should dismiss the panel,
    // matching the behaviour of a click outside. Mouse focus loss is handled
    // by the panel's own click-outside listener so the badge buttons keep
    // working.
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const controller = badges.get(target);
      if (controller !== undefined) controller.close();
    };

    const attach = (field: HTMLInputElement) => {
      if (badges.has(field)) return;
      const controller = attachBadge(field);
      badges.set(field, controller);
      // Open the badge automatically on focus.
      field.addEventListener("focus", openHandler);
      field.addEventListener("keydown", keyHandler);
    };

    const scan = () => {
      for (const field of findPasswordFields()) attach(field);
    };

    scan();

    const observer = new MutationObserver((mutations) => {
      let needsScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          needsScan = true;
          break;
        }
      }
      if (needsScan) scan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  },
});

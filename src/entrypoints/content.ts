/**
 * Content script entrypoint.
 *
 * Scans the page for password fields, attaches a floating badge to each, and
 * watches for dynamically added fields. Crypto, storage and the master
 * password are all confined to the background service worker; this script
 * is only a thin DOM observer + UI host.
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { attachBadge, type BadgeController } from "../content/badge.js";
import { findPasswordFields } from "../content/detect.js";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",

  main() {
    if (window === window.top && window.location.protocol === "chrome:") return;

    const badges = new WeakMap<HTMLInputElement, BadgeController>();

    const attach = (field: HTMLInputElement) => {
      if (badges.has(field)) return;
      const controller = attachBadge(field);
      badges.set(field, controller);
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

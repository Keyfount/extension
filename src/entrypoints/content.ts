/**
 * Content script entrypoint.
 *
 * Scans the page for password fields, attaches a floating badge to each (and
 * to its associated username/email field), and opens the panel automatically
 * when either field receives focus. Crypto and the master password stay
 * inside the background service worker.
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { attachBadge, showSaveBanner, type BadgeController } from "../content/Badge.js";
import { findPasswordFields, findUsernameFieldFor } from "../content/detect.js";
import { send } from "../content/messaging.js";
import { registrableDomain } from "../shared/domain.js";

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

    const keyHandler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const controller = badges.get(target);
      if (controller !== undefined) controller.close();
    };

    const attachTo = (
      field: HTMLInputElement,
      options: {
        password: HTMLInputElement;
        username: HTMLInputElement | null;
        anchor: "password" | "username";
      },
    ) => {
      if (badges.has(field)) return;
      const controller = attachBadge(options);
      badges.set(field, controller);
      field.addEventListener("focus", openHandler);
      field.addEventListener("keydown", keyHandler);
    };

    const scan = () => {
      for (const password of findPasswordFields()) {
        const username = findUsernameFieldFor(password);
        attachTo(password, { password, username, anchor: "password" });
        if (username !== null) {
          attachTo(username, { password, username, anchor: "username" });
        }
      }
    };

    scan();

    // After a successful Fill the user may navigate (form submit) before
    // dismissing the save banner. The background keeps a short-TTL marker;
    // if one exists for this domain on page load, re-surface the banner.
    if (window === window.top) {
      const currentDomain = registrableDomain(window.location.href);
      if (currentDomain !== null) {
        send({ kind: "getPendingSave", domain: currentDomain })
          .then((res) => {
            if (res.entry !== null) {
              void showSaveBanner({
                domain: currentDomain,
                username: res.entry.username,
                ...(res.entry.profile !== undefined ? { profile: res.entry.profile } : {}),
              });
            }
          })
          .catch(() => {
            /* swallowed */
          });
      }
    }

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

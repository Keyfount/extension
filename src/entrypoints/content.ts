/**
 * Content script entrypoint.
 *
 * Scans the page for password fields, attaches a floating badge to each (and
 * to its associated username/email field), and opens the panel automatically
 * when either field receives focus. Crypto and the master password stay
 * inside the background service worker.
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  attachBadge,
  showRotateBanner,
  showSaveBanner,
  type BadgeController,
} from "../content/Badge.js";
import {
  findPasswordFields,
  findUsernameFieldFor,
  isChangePasswordPage,
} from "../content/detect.js";
import { isTopFrame } from "../content/iframe-guard.js";
import { send } from "../content/messaging.js";
import { registrableDomain } from "../shared/domain.js";

export default defineContentScript({
  matches: ["<all_urls>"],
  // allFrames intentionally omitted: subframes would derive passwords from the
  // iframe's URL, which an attacker controls. See iframe-guard.ts.
  runAt: "document_idle",

  main() {
    if (!isTopFrame(window)) return;
    if (window.location.protocol === "chrome:") return;

    const badges = new WeakMap<HTMLInputElement, BadgeController>();
    // A page can carry several detected fields (e.g. email + password), each
    // with its own badge. Only one panel should be open at a time: opening a
    // second while the first is still up leaves two floating "Fill" panels
    // (reachable by clicking — not tabbing — between fields, since the
    // click-outside guard treats the shared password field as "inside").
    const controllers = new Set<BadgeController>();

    const openHandler = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const controller = badges.get(target);
      if (controller === undefined) return;
      for (const other of controllers) {
        if (other !== controller) other.close();
      }
      controller.open();
    };

    const keyHandler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const controller = badges.get(target);
      if (controller !== undefined) controller.close();
    };

    // Debounced cache of what the user typed in each username field, so a
    // sign-up flow that splits email (page 1) from password (page 2) can
    // pick up the email on page 2.
    const lastSentByField = new WeakMap<HTMLInputElement, string>();
    const inputHandler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const value = target.value.trim();
      if (value.length === 0) return;
      if (lastSentByField.get(target) === value) return;
      lastSentByField.set(target, value);
      const domain = registrableDomain(window.location.href);
      if (domain === null) return;
      send({ kind: "setRecentUsername", domain, username: value }).catch(() => {
        /* swallowed */
      });
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
      controllers.add(controller);
      field.addEventListener("focus", openHandler);
      field.addEventListener("keydown", keyHandler);
      if (options.anchor === "username") {
        field.addEventListener("blur", inputHandler);
        field.addEventListener("change", inputHandler);
      }
    };

    const scan = () => {
      for (const password of findPasswordFields()) {
        const username = findUsernameFieldFor(password);
        attachTo(password, { password, username, anchor: "password" });
        if (username !== null) {
          attachTo(username, { password, username, anchor: "username" });
        }
      }
      // Also watch standalone email/username inputs that don't have a
      // sibling password field (sign-up page 1) so we can stash the value
      // for the next page.
      const standalone = document.querySelectorAll<HTMLInputElement>(
        'input[type="email"], input[autocomplete="email"], input[autocomplete="username"]',
      );
      for (const el of standalone) {
        if (lastSentByField.has(el)) continue;
        lastSentByField.set(el, el.value.trim());
        el.addEventListener("blur", inputHandler);
        el.addEventListener("change", inputHandler);
      }
    };

    scan();

    // After a successful Fill the user may navigate (form submit) before
    // dismissing the save banner. The background keeps a short-TTL marker;
    // if one exists for this domain on page load, re-surface the banner.
    if (window === window.top) {
      const currentDomain = registrableDomain(window.location.href);
      if (currentDomain !== null && isChangePasswordPage(document)) {
        // Password-change form detected → if the user has a saved
        // account for this site, surface a rotation banner. We only
        // auto-rotate for a single matching entry; with several we
        // pick the most recently used and let the user dismiss.
        send({ kind: "listAccounts", domain: currentDomain })
          .then((res) => {
            const entries = res.entries;
            if (entries.length === 0) return;
            const best = [...entries].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]!;
            void showRotateBanner({ entry: best });
          })
          .catch(() => {
            /* swallowed */
          });
      }
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

    // Context-menu "Fill with Keyfount" → focus the first password
    // field on the page so its badge opens; the panel then handles the
    // generate + fill flow normally.
    chrome.runtime.onMessage.addListener((message) => {
      if (
        message !== null &&
        typeof message === "object" &&
        "kind" in message &&
        (message as { kind: unknown }).kind === "clipboard:clear"
      ) {
        // Best-effort wipe from the focused tab when the popup is closed.
        navigator.clipboard.writeText("").catch(() => {
          /* page may not have clipboard-write permission; ignore */
        });
        return false;
      }
      if (
        message !== null &&
        typeof message === "object" &&
        "kind" in message &&
        (message as { kind: unknown }).kind === "keyfount:fill-here"
      ) {
        const targets = findPasswordFields();
        const target = targets[0];
        if (target !== undefined) {
          try {
            target.focus();
          } catch {
            /* swallowed */
          }
          const controller = badges.get(target);
          if (controller !== undefined) controller.open();
        }
      }
      return false;
    });

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

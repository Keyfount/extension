/**
 * Vault loader. Centralises the popup's "what's the current state of the
 * world" fetch so it can run both at App mount and after a successful
 * unlock — the latter is the path that was silently broken (the list
 * arrived empty until the user reopened the popup).
 *
 * Signals it touches:
 *   - hasPin, historyEnabled, faviconFallbackEnabled
 *   - activeDomain, activeEmail
 *   - allAccounts, savedAccounts
 */
import { send } from "./api.js";
import {
  activeDomain,
  activeEmail,
  activeHost,
  allAccounts,
  faviconFallbackEnabled,
  hasPin,
  historyEnabled,
  savedAccounts,
} from "./state.js";
import { fullHost, matchAccounts, registrableDomain } from "../shared/domain.js";

export async function loadVaultData(): Promise<void> {
  try {
    const state = await send({ kind: "getState" });
    hasPin.value = state.hasPin;
    historyEnabled.value = state.historyEnabled;
    faviconFallbackEnabled.value = state.faviconFallbackEnabled;
  } catch {
    hasPin.value = false;
    historyEnabled.value = false;
    faviconFallbackEnabled.value = true;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const domain = tab?.url ? registrableDomain(tab.url) : null;
  activeDomain.value = domain;
  activeHost.value = tab?.url ? fullHost(tab.url) : null;
  activeEmail.value = "";
  savedAccounts.value = [];
  allAccounts.value = [];

  if (historyEnabled.value) {
    try {
      const res = await send({ kind: "listAccounts" });
      allAccounts.value = res.entries;
      // Offer accounts whose match set covers the current host (registrable
      // → all subdomains, full-host → exact, plus linked domains).
      savedAccounts.value = tab?.url ? matchAccounts(tab.url, res.entries) : [];
    } catch {
      allAccounts.value = [];
      savedAccounts.value = [];
    }
  }

  if (tab?.id !== undefined && domain !== null) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const candidates = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[type="email"], input[type="text"], input[type="tel"], input:not([type])',
            ),
          ).filter((el) => el.offsetParent !== null && !el.disabled);
          const hintRe = /user(name)?|login|email|e-?mail/i;
          for (const el of candidates) {
            const hint = (el.getAttribute("autocomplete") ?? "").toLowerCase();
            if (hint === "username" || hint === "email") {
              const v = el.value.trim();
              if (v.length > 0) return v;
            }
          }
          for (const el of candidates) {
            const attrs = [
              el.name,
              el.id,
              el.placeholder,
              el.getAttribute("aria-label") ?? "",
            ].join(" ");
            if (hintRe.test(attrs)) {
              const v = el.value.trim();
              if (v.length > 0) return v;
            }
          }
          return "";
        },
      });
      const detected = result?.result;
      if (typeof detected === "string" && detected.length > 0) {
        activeEmail.value = detected;
      }
    } catch {
      /* page not scriptable */
    }
  }

  // Sign-up multi-page fallback: nothing in the current tab, but the
  // content script may have stashed the email the user typed earlier.
  if (activeEmail.value.length === 0 && domain !== null) {
    try {
      const recent = await send({ kind: "getRecentUsername", domain });
      if (recent.username !== null) {
        activeEmail.value = recent.username;
      }
    } catch {
      /* swallowed */
    }
  }
}

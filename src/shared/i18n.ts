/**
 * Tiny wrapper around chrome.i18n.
 *
 * Chrome picks the locale from `_locales/<UI_LOCALE>/messages.json` based on
 * the browser's UI language. We expose a single `t()` helper so components
 * don't import `chrome.*` directly — easier to mock in tests later.
 */

export function t(key: string, ...substitutions: string[]): string {
  if (typeof chrome === "undefined" || chrome.i18n === undefined) return key;
  const result = chrome.i18n.getMessage(key, substitutions);
  return result === "" ? key : result;
}

export function currentLocale(): string {
  if (typeof chrome === "undefined" || chrome.i18n === undefined) return "en";
  return chrome.i18n.getUILanguage();
}

/**
 * Resolve a favicon URL for a registrable domain using Chrome's built-in
 * `_favicon` service. Requires the `"favicon"` manifest permission.
 *
 * The browser already has favicons cached from the user's normal browsing,
 * so this never hits the network. Falling back to `null` lets callers show
 * a generic placeholder when the API is unavailable (e.g. tests, Firefox).
 */
export function faviconUrl(domain: string, size = 32): string | null {
  if (typeof chrome === "undefined" || chrome.runtime === undefined) return null;
  const get = chrome.runtime.getURL?.bind(chrome.runtime);
  if (get === undefined) return null;
  const target = `https://${domain}`;
  return get(`_favicon/?pageUrl=${encodeURIComponent(target)}&size=${size}`);
}

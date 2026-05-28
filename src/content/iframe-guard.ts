/**
 * Iframe guard for the content script.
 *
 * Keyfount derives passwords from `window.location.href`. Inside a subframe
 * that URL belongs to the iframe, not to the page the user is actually
 * looking at, so a malicious top page that embeds `<iframe src="bank.example">`
 * can trick the extension into deriving and writing a `bank.example` password
 * into a DOM the attacker controls, then exfiltrate it via `postMessage`.
 *
 * The hard mitigation is in the manifest (`allFrames` is left at its default
 * `false`); this helper is defence-in-depth for any future entrypoint that
 * might be loaded inside a frame.
 */
export function isTopFrame(win: Window): boolean {
  try {
    return win === win.top;
  } catch {
    // Cross-origin access to `top` throws SecurityError — that already means
    // we are inside a subframe of a different origin, so bail out.
    return false;
  }
}

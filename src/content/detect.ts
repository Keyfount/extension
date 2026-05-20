/**
 * Password-field and username-field detection.
 *
 * Heuristics chosen to be conservative: we'd rather miss an exotic form than
 * fire on the wrong field of a real one. The two functions below are pure
 * (operate on a Document or Element only), making them easy to unit-test
 * against happy-dom fixtures.
 */

const PASSWORD_SELECTOR = 'input[type="password"]:not([autocomplete="one-time-code"])';

const USERNAME_HINT_RE = /user(name)?|login|email|e-?mail/i;

/**
 * Find every password input that's currently in the document, including
 * those reachable through *open* shadow roots. Closed shadow roots are not
 * reachable from script and are skipped.
 */
export function findPasswordFields(root: Document | ShadowRoot = document): HTMLInputElement[] {
  const out: HTMLInputElement[] = [];
  collectInputs(root, out);
  return out;
}

function collectInputs(root: Document | ShadowRoot, out: HTMLInputElement[]): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(PASSWORD_SELECTOR)) {
    out.push(input);
  }
  // Recurse into open shadow roots — querySelectorAll does not pierce them.
  const candidates = root.querySelectorAll<Element>("*");
  for (const el of candidates) {
    const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow !== null) collectInputs(shadow, out);
  }
}

/**
 * Given a password field, look up the most likely username/email field on
 * the same form (or the same containing element if there's no form).
 *
 * Returns `null` when nothing convincing is found — the caller should ask
 * the user.
 */
export function findUsernameFieldFor(password: HTMLInputElement): HTMLInputElement | null {
  const scope = password.form ?? password.closest("section,div,main,article,body") ?? document.body;
  if (scope === null) return null;

  const candidates = Array.from(
    scope.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[type="text"], input[type="tel"], input:not([type])',
    ),
  ).filter((el) => el !== password && isElementVisible(el));

  if (candidates.length === 0) return null;

  // 1. Prefer explicit autocomplete hints.
  for (const el of candidates) {
    const hint = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (hint === "username" || hint === "email") return el;
  }

  // 2. Match on name/id/placeholder/aria-label.
  for (const el of candidates) {
    const attrs = [el.name, el.id, el.placeholder, el.getAttribute("aria-label") ?? ""].join(" ");
    if (USERNAME_HINT_RE.test(attrs)) return el;
  }

  // 3. Fall back to the closest preceding text-like input (DOM order).
  for (const el of candidates) {
    const position = password.compareDocumentPosition(el);
    if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return el;
  }

  return null;
}

/**
 * Read the current value of a username field if one is found.
 * Empty string is returned both when the field is missing and when it is empty
 * — the caller treats both the same way (fall back to popup input).
 */
export function readUsername(password: HTMLInputElement): string {
  const field = findUsernameFieldFor(password);
  if (field === null) return "";
  return field.value.trim();
}

function isElementVisible(el: HTMLInputElement): boolean {
  // happy-dom does not implement getBoundingClientRect properly for hidden
  // nodes, so we look at the layout-affecting attributes only.
  if (el.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.type === "hidden") return false;
  return true;
}

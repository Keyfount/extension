/**
 * Domain normalisation.
 *
 * The extension uses the **registrable** domain (the smallest unit that a
 * single party can register at a registrar) as part of the derivation salt,
 * so that all subdomains of one service share the same generated password.
 *
 * We delegate to `tldts`, which ships the Mozilla Public Suffix List and is
 * dependency-free and audit-friendly.
 */
import { getDomain, getHostname } from "tldts";

/**
 * Extract the registrable domain from a URL or hostname.
 *
 * Returns `null` for inputs that don't resolve to a public registrable
 * domain — typically `chrome://`, `file://`, IP literals or `localhost`. The
 * caller should fall back to a UI that asks the user what to do.
 *
 * Examples:
 *   "https://accounts.google.com/signin" → "google.com"
 *   "https://www.example.co.uk"          → "example.co.uk"
 *   "chrome://extensions"                → null
 *   "http://localhost:3000"              → null
 */
export function registrableDomain(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) {
    return null;
  }
  const domain = getDomain(input, { allowPrivateDomains: false });
  return domain && domain.length > 0 ? domain.toLowerCase() : null;
}

/**
 * Full lowercased hostname of an http(s) URL, or `null` for anything we
 * won't autofill (chrome://, file://, about:, empty, unparseable).
 */
export function fullHost(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) {
    return null;
  }
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
  } catch {
    /* bare hostname — fall through to tldts */
  }
  const host = getHostname(input);
  return host && host.length > 0 ? host.toLowerCase() : null;
}

/**
 * Rank a single match domain against a host:
 *   2 = exact-host (narrow) match, 1 = registrable (broad) match, -1 = none.
 *
 * A match domain that equals its own registrable domain is broad: it
 * matches the registrable root and every subdomain. Any other match domain
 * is a specific host and matches that host exactly.
 */
function matchRank(matchDomain: string, host: string): number {
  const m = matchDomain.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (m.length === 0 || h.length === 0) {
    return -1;
  }
  if (registrableDomain(m) === m) {
    return h === m || h.endsWith("." + m) ? 1 : -1;
  }
  return h === m ? 2 : -1;
}

/** True when `matchDomain` (registrable → broad, full host → narrow) covers `host`. */
export function domainMatches(matchDomain: string, host: string): boolean {
  return matchRank(matchDomain, host) >= 0;
}

/**
 * Filter + rank accounts whose match set ({domain} ∪ linkedDomains) covers
 * the URL's host. Returns most-specific first (exact-host before
 * registrable), then most-recently-used. Empty for non-web URLs.
 *
 * Matching is match-only: an account's `domain` remains its derivation salt;
 * `linkedDomains` never affect derivation.
 */
export function matchAccounts<
  T extends { domain: string; linkedDomains?: string[]; lastUsedAt: number },
>(url: string, accounts: readonly T[]): T[] {
  const host = fullHost(url);
  if (host === null || registrableDomain(url) === null) {
    return [];
  }
  const ranked: Array<{ entry: T; rank: number }> = [];
  for (const entry of accounts) {
    let best = -1;
    for (const m of [entry.domain, ...(entry.linkedDomains ?? [])]) {
      best = Math.max(best, matchRank(m, host));
    }
    if (best >= 0) {
      ranked.push({ entry, rank: best });
    }
  }
  ranked.sort((a, b) => b.rank - a.rank || b.entry.lastUsedAt - a.entry.lastUsedAt);
  return ranked.map((r) => r.entry);
}

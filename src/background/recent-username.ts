/**
 * Short-lived memory of the last username/email the user typed on a given
 * registrable domain. Lets the badge on a sign-up's password page
 * pre-fill from what the user entered on the previous email-only page.
 *
 * Lives in chrome.storage.session so the value is wiped when the browser
 * closes. Entries expire after a few minutes so a long browsing session
 * doesn't keep re-suggesting an unrelated value.
 */
const STORAGE_KEY = "recentUsernames";
const TTL_MS = 5 * 60 * 1000;

interface Record {
  username: string;
  ts: number;
}

type Store = Record_<string, Record>;
// Local alias so `Record` above doesn't shadow the global utility type.
type Record_<K extends string, V> = { [P in K]: V };

async function readStore(): Promise<Store> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.session.get(STORAGE_KEY);
  if (raw === undefined || raw === null || typeof raw !== "object") return {};
  return raw as Store;
}

async function writeStore(store: Store): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: store });
}

export async function setRecentUsername(domain: string, username: string): Promise<void> {
  const trimmed = username.trim();
  if (trimmed.length === 0) return;
  const store = await readStore();
  store[domain] = { username: trimmed, ts: Date.now() };
  await writeStore(store);
}

export async function getRecentUsername(domain: string): Promise<string | null> {
  const store = await readStore();
  const entry = store[domain];
  if (entry === undefined) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    delete store[domain];
    await writeStore(store);
    return null;
  }
  return entry.username;
}

export async function clearRecentUsername(domain: string): Promise<void> {
  const store = await readStore();
  if (store[domain] === undefined) return;
  delete store[domain];
  await writeStore(store);
}

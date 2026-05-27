/**
 * Profile registry.
 *
 * A "profile" (a.k.a. coffre/vault) is an isolated identity inside the
 * extension: its own master password, settings, encrypted accounts list and
 * sync session. Only one profile is active at a time — switching profiles
 * locks the session and unlocks the destination with its own master.
 *
 * Storage layout once a registry exists:
 *
 *   profiles.registry.v1                          → this module
 *   profiles.{id}.bootManifest.v1                 → storage.ts (plaintext)
 *   profiles.{id}.state.v1                        → storage.ts (encrypted)
 *   profiles.{id}.accountsCipher                  → accounts.ts
 *   profiles.{id}.sync.session.v1                 → sync/session-store.ts
 *   profiles.{id}.sync.cursor.v1
 *   profiles.{id}.sync.lamport.v1
 *   profiles.{id}.sync.lastSyncAt.v1              → sync/engine.ts
 *
 * On first access after upgrading from a single-vault install, legacy
 * top-level keys (state.v1, accountsCipher, sync.*) are adopted as the
 * first profile and removed.
 */

const REGISTRY_KEY = "profiles.registry.v1";
const LEGACY_KEYS = {
  state: "state.v1",
  accounts: "accountsCipher",
  syncSession: "sync.session.v1",
  syncCursor: "sync.cursor.v1",
  syncLamport: "sync.lamport.v1",
  syncLastAt: "sync.lastSyncAt.v1",
} as const;

export interface ProfileMeta {
  id: string;
  /** 3-byte master fingerprint, hex-encoded; same format as state.fingerprint. */
  fingerprint: string;
  createdAt: number;
  lastUsedAt: number;
}

interface Registry {
  schemaVersion: 1;
  activeId: string | null;
  profiles: ProfileMeta[];
}

const EMPTY_REGISTRY: Registry = {
  schemaVersion: 1,
  activeId: null,
  profiles: [],
};

let migrationPromise: Promise<Registry> | null = null;

function profileKey(id: string, suffix: string): string {
  return `profiles.${id}.${suffix}`;
}

export function stateKey(id: string): string {
  return profileKey(id, "state.v1");
}

/**
 * Plaintext boot manifest key. Mirrors {@link stateKey} but holds only the
 * fields the unlock screen needs before the master is available
 * (schemaVersion, fingerprint, pin, autoLockMinutes). Everything else lives
 * inside the encrypted blob at {@link stateKey}.
 */
export function bootManifestKey(id: string): string {
  return profileKey(id, "bootManifest.v1");
}

export function accountsKey(id: string): string {
  return profileKey(id, "accountsCipher");
}

export function syncSessionKey(id: string): string {
  return profileKey(id, "sync.session.v1");
}

export function syncCursorKey(id: string): string {
  return profileKey(id, "sync.cursor.v1");
}

export function syncLamportKey(id: string): string {
  return profileKey(id, "sync.lamport.v1");
}

export function syncLastAtKey(id: string): string {
  return profileKey(id, "sync.lastSyncAt.v1");
}

async function readRegistry(): Promise<Registry | null> {
  const { [REGISTRY_KEY]: raw } = await chrome.storage.local.get(REGISTRY_KEY);
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Registry>;
  if (r.schemaVersion !== 1 || !Array.isArray(r.profiles)) return null;
  return {
    schemaVersion: 1,
    activeId: typeof r.activeId === "string" ? r.activeId : null,
    profiles: r.profiles.filter(isProfileMeta),
  };
}

function isProfileMeta(value: unknown): value is ProfileMeta {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as ProfileMeta).id === "string" &&
    typeof (value as ProfileMeta).fingerprint === "string" &&
    typeof (value as ProfileMeta).createdAt === "number" &&
    typeof (value as ProfileMeta).lastUsedAt === "number"
  );
}

async function writeRegistry(registry: Registry): Promise<void> {
  await chrome.storage.local.set({ [REGISTRY_KEY]: registry });
}

/**
 * Read the registry, running the one-shot legacy migration if needed.
 * Re-entrant: concurrent callers share the same migration promise.
 */
async function ensureRegistry(): Promise<Registry> {
  const existing = await readRegistry();
  if (existing !== null) return existing;
  if (migrationPromise === null) {
    migrationPromise = adoptLegacyKeysOrEmpty().finally(() => {
      migrationPromise = null;
    });
  }
  return migrationPromise;
}

/**
 * If legacy single-vault keys exist, adopt them as profile #1; otherwise
 * write and return an empty registry.
 */
async function adoptLegacyKeysOrEmpty(): Promise<Registry> {
  const second = await readRegistry();
  if (second !== null) return second; // beat us to it

  const legacy = await chrome.storage.local.get([
    LEGACY_KEYS.state,
    LEGACY_KEYS.accounts,
    LEGACY_KEYS.syncSession,
    LEGACY_KEYS.syncCursor,
    LEGACY_KEYS.syncLamport,
    LEGACY_KEYS.syncLastAt,
  ]);

  const legacyState = legacy[LEGACY_KEYS.state] as { fingerprint?: string } | undefined;
  if (legacyState === undefined) {
    await writeRegistry(EMPTY_REGISTRY);
    return EMPTY_REGISTRY;
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const fingerprint = typeof legacyState.fingerprint === "string" ? legacyState.fingerprint : "";

  const writes: Record<string, unknown> = {};
  writes[stateKey(id)] = legacyState;
  for (const [legacyKey, targetKey] of [
    [LEGACY_KEYS.accounts, accountsKey(id)],
    [LEGACY_KEYS.syncSession, syncSessionKey(id)],
    [LEGACY_KEYS.syncCursor, syncCursorKey(id)],
    [LEGACY_KEYS.syncLamport, syncLamportKey(id)],
    [LEGACY_KEYS.syncLastAt, syncLastAtKey(id)],
  ] as const) {
    if (legacy[legacyKey] !== undefined) {
      writes[targetKey] = legacy[legacyKey];
    }
  }
  await chrome.storage.local.set(writes);

  const registry: Registry = {
    schemaVersion: 1,
    activeId: id,
    profiles: [{ id, fingerprint, createdAt: now, lastUsedAt: now }],
  };
  await writeRegistry(registry);

  await chrome.storage.local.remove([
    LEGACY_KEYS.state,
    LEGACY_KEYS.accounts,
    LEGACY_KEYS.syncSession,
    LEGACY_KEYS.syncCursor,
    LEGACY_KEYS.syncLamport,
    LEGACY_KEYS.syncLastAt,
  ]);

  return registry;
}

/** Return the active profile id, or `null` on a truly fresh install. */
export async function getActiveProfileId(): Promise<string | null> {
  const registry = await ensureRegistry();
  return registry.activeId;
}

/** Same, but throws — convenience for storage modules that always need one. */
export async function requireActiveProfileId(): Promise<string> {
  const id = await getActiveProfileId();
  if (id === null) {
    throw new Error("no_active_profile");
  }
  return id;
}

export async function listProfiles(): Promise<ProfileMeta[]> {
  const registry = await ensureRegistry();
  return [...registry.profiles].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * Create a new profile with the supplied fingerprint and make it active.
 * Returns the new profile metadata.
 */
export async function createProfile(fingerprint: string): Promise<ProfileMeta> {
  const registry = await ensureRegistry();
  const id = crypto.randomUUID();
  const now = Date.now();
  const meta: ProfileMeta = { id, fingerprint, createdAt: now, lastUsedAt: now };
  const next: Registry = {
    schemaVersion: 1,
    activeId: id,
    profiles: [...registry.profiles, meta],
  };
  await writeRegistry(next);
  return meta;
}

/**
 * Drop the active pointer without deleting any profile. Used right before
 * routing to the setup screen to create an additional vault — bootstrap
 * sees `isFirstRun: true` and runs setup, which then calls
 * {@link createProfile} for the new fingerprint.
 */
export async function clearActiveProfile(): Promise<void> {
  const registry = await ensureRegistry();
  if (registry.activeId === null) return;
  await writeRegistry({ ...registry, activeId: null });
}

/**
 * Switch the active profile. The caller is responsible for locking the
 * current session first — this only mutates the registry pointer.
 */
export async function setActiveProfile(id: string): Promise<void> {
  const registry = await ensureRegistry();
  if (!registry.profiles.some((p) => p.id === id)) {
    throw new Error("unknown_profile");
  }
  const now = Date.now();
  const next: Registry = {
    schemaVersion: 1,
    activeId: id,
    profiles: registry.profiles.map((p) => (p.id === id ? { ...p, lastUsedAt: now } : p)),
  };
  await writeRegistry(next);
}

/**
 * Delete a profile and every storage key it owns.
 *
 * If the deleted profile was active, the next one (by lastUsedAt) becomes
 * active, or `activeId` becomes null when none remain (the next setup
 * will create a fresh first profile).
 */
export async function deleteProfile(id: string): Promise<void> {
  const registry = await ensureRegistry();
  if (!registry.profiles.some((p) => p.id === id)) return;
  const remaining = registry.profiles.filter((p) => p.id !== id);
  let nextActive: string | null = registry.activeId;
  if (registry.activeId === id) {
    const fallback = [...remaining].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    nextActive = fallback?.id ?? null;
  }
  const next: Registry = {
    schemaVersion: 1,
    activeId: nextActive,
    profiles: remaining,
  };
  await writeRegistry(next);
  await chrome.storage.local.remove([
    stateKey(id),
    bootManifestKey(id),
    accountsKey(id),
    syncSessionKey(id),
    syncCursorKey(id),
    syncLamportKey(id),
    syncLastAtKey(id),
  ]);
}

/** Refresh the fingerprint cached in the registry for `id`. */
export async function updateProfileFingerprint(id: string, fingerprint: string): Promise<void> {
  const registry = await ensureRegistry();
  if (!registry.profiles.some((p) => p.id === id)) return;
  const next: Registry = {
    ...registry,
    profiles: registry.profiles.map((p) =>
      p.id === id ? { ...p, fingerprint, lastUsedAt: Date.now() } : p,
    ),
  };
  await writeRegistry(next);
}

/** Bump the `lastUsedAt` of the active profile. */
export async function touchActiveProfile(): Promise<void> {
  const registry = await ensureRegistry();
  if (registry.activeId === null) return;
  const id = registry.activeId;
  const now = Date.now();
  const next: Registry = {
    ...registry,
    profiles: registry.profiles.map((p) => (p.id === id ? { ...p, lastUsedAt: now } : p)),
  };
  await writeRegistry(next);
}

/** Wipe every profile and its data — used by the "Forget everything" path. */
export async function wipeAllProfiles(): Promise<void> {
  const registry = await readRegistry();
  if (registry !== null) {
    const keys: string[] = [REGISTRY_KEY];
    for (const p of registry.profiles) {
      keys.push(
        stateKey(p.id),
        bootManifestKey(p.id),
        accountsKey(p.id),
        syncSessionKey(p.id),
        syncCursorKey(p.id),
        syncLamportKey(p.id),
        syncLastAtKey(p.id),
      );
    }
    await chrome.storage.local.remove(keys);
  }
  await chrome.storage.local.remove([
    LEGACY_KEYS.state,
    LEGACY_KEYS.accounts,
    LEGACY_KEYS.syncSession,
    LEGACY_KEYS.syncCursor,
    LEGACY_KEYS.syncLamport,
    LEGACY_KEYS.syncLastAt,
  ]);
}

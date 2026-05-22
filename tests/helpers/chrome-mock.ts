/**
 * Minimal in-memory chrome.* mock for unit-testing the background modules.
 *
 * Only the surface area used by the extension is implemented. Anything else
 * deliberately throws so missing coverage shows up immediately.
 */

type StorageArea = {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
  clear: () => Promise<void>;
  setAccessLevel?: (cfg: { accessLevel: string }) => Promise<void>;
};

function createStorageArea(): StorageArea {
  let store: Record<string, unknown> = {};
  return {
    get: async (keys) => {
      if (keys === undefined || keys === null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (key in store) out[key] = store[key];
      }
      return out;
    },
    set: async (items) => {
      store = { ...store, ...items };
    },
    remove: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete store[key];
    },
    clear: async () => {
      store = {};
    },
    setAccessLevel: async () => {
      // no-op
    },
  };
}

interface AlarmsApi {
  create: (name: string, info: chrome.alarms.AlarmCreateInfo) => Promise<void>;
  clear: (name: string) => Promise<boolean>;
  onAlarm: {
    addListener: (cb: (alarm: chrome.alarms.Alarm) => void) => void;
  };
  __fire: (name: string) => void;
}

function createAlarmsApi(): AlarmsApi {
  const listeners: Array<(alarm: chrome.alarms.Alarm) => void> = [];
  const scheduled = new Set<string>();
  return {
    create: async (name) => {
      scheduled.add(name);
    },
    clear: async (name) => scheduled.delete(name),
    onAlarm: {
      addListener: (cb) => {
        listeners.push(cb);
      },
    },
    __fire: (name) => {
      for (const cb of listeners) cb({ name, scheduledTime: Date.now() });
    },
  };
}

/**
 * Force an active vault profile so storage-touching modules can write without
 * tripping the "no_active_profile" guard. Seeds the legacy state.v1 key so
 * the first read triggers the registry migration — same path production uses
 * on upgrade from a single-vault install.
 */
export async function bootstrapTestProfile(opts: { fingerprint?: string } = {}): Promise<void> {
  await chrome.storage.local.set({
    "state.v1": {
      schemaVersion: 4,
      defaultProfile: {
        mode: "random",
        length: 16,
        lower: true,
        upper: true,
        digits: true,
        symbols: true,
        counter: 1,
      },
      autoLockMinutes: 15,
      historyEnabled: true,
      faviconFallbackEnabled: true,
      clipboardClearSeconds: 30,
      fingerprint: opts.fingerprint ?? "",
      sites: {},
    },
  });
  // First read triggers migration; we discard the result.
  const { loadState } = await import("../../src/background/storage.js");
  await loadState();
}

export function installChromeMock(): {
  alarms: AlarmsApi;
  reset: () => void;
} {
  const local = createStorageArea();
  const session = createStorageArea();
  const alarms = createAlarmsApi();

  const fakeChrome = {
    storage: { local, session },
    alarms,
    runtime: {
      onMessage: { addListener: () => undefined },
      sendMessage: async () => undefined,
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome;

  return {
    alarms,
    reset: () => {
      void local.clear();
      void session.clear();
    },
  };
}

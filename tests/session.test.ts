import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import {
  hardenSessionStorage,
  lock,
  readMaster,
  registerAutoLockHandler,
  status,
  unlock,
} from "../src/background/session.js";

const mock = installChromeMock();

beforeEach(() => {
  mock.reset();
});

describe("hardenSessionStorage", () => {
  it("is idempotent and does not throw when setAccessLevel is available", async () => {
    await expect(hardenSessionStorage()).resolves.toBeUndefined();
    await expect(hardenSessionStorage()).resolves.toBeUndefined();
  });
});

describe("session lifecycle", () => {
  it("starts locked", async () => {
    const s = await status();
    expect(s.locked).toBe(true);
    expect(await readMaster()).toBeNull();
  });

  it("stores the master on unlock and clears it on lock", async () => {
    await unlock("hunter2", 15);
    expect(await readMaster()).toBe("hunter2");
    const s = await status();
    expect(s.locked).toBe(false);
    expect(s.unlockedAt).not.toBeNull();

    await lock();
    expect(await readMaster()).toBeNull();
    expect((await status()).locked).toBe(true);
  });
});

describe("auto-lock", () => {
  it("fires the alarm listener that wipes the session", async () => {
    registerAutoLockHandler();
    await unlock("hunter2", 15);
    expect(await readMaster()).toBe("hunter2");

    mock.alarms.__fire("keyfount:auto-lock");
    // The listener kicks off lock() asynchronously; wait one tick.
    await Promise.resolve();
    await Promise.resolve();

    expect(await readMaster()).toBeNull();
  });

  it("ignores alarms with other names", async () => {
    registerAutoLockHandler();
    await unlock("hunter2", 15);
    mock.alarms.__fire("some-other-alarm");
    await Promise.resolve();
    expect(await readMaster()).toBe("hunter2");
  });
});

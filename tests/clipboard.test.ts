import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import {
  armClipboardClear,
  cancelClipboardClear,
  registerClipboardClearHandler,
} from "../src/background/clipboard.js";

const mock = installChromeMock();

beforeEach(() => {
  mock.reset();
});

describe("clipboard auto-clear scheduler", () => {
  it("returns null and clears the alarm when seconds <= 0", async () => {
    const token = await armClipboardClear(0);
    expect(token).toBeNull();
  });

  it("returns a token when arming with positive seconds", async () => {
    const token = await armClipboardClear(30);
    expect(token).not.toBeNull();
    expect(typeof token).toBe("string");
  });

  it("re-arming overrides the previous token", async () => {
    const first = await armClipboardClear(30);
    const second = await armClipboardClear(60);
    expect(first).not.toBe(second);
  });

  it("cancel clears the alarm", async () => {
    await armClipboardClear(30);
    await expect(cancelClipboardClear()).resolves.toBeUndefined();
  });

  it("registering the handler broadcasts on alarm fire", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    (
      globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }
    ).chrome.runtime.sendMessage = sendMessage;
    registerClipboardClearHandler();
    await armClipboardClear(10);
    mock.alarms.__fire("keyfount:clipboard-clear");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "clipboard:clear" }));
  });
});

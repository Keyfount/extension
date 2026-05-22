import { describe, it, expect, vi, beforeEach } from "vitest";

import { BackgroundError, send } from "../src/shared/api.js";

function setupChrome(impl: (msg: unknown) => Promise<unknown>): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: vi.fn(impl) },
  };
}

describe("send", () => {
  beforeEach(() => {
    setupChrome(async () => undefined);
  });

  it("returns the response on success", async () => {
    setupChrome(async () => ({
      ok: true,
      locked: false,
      isFirstRun: false,
      fingerprint: null,
      hasPin: false,
    }));
    const res = await send({ kind: "status" });
    expect(res.ok).toBe(true);
  });

  it("throws BackgroundError when the response is undefined", async () => {
    setupChrome(async () => undefined);
    await expect(send({ kind: "status" })).rejects.toBeInstanceOf(BackgroundError);
  });

  it("throws BackgroundError when the background returns an error envelope", async () => {
    setupChrome(async () => ({ ok: false, error: "kaboom" }));
    await expect(send({ kind: "status" })).rejects.toThrow(/kaboom/);
  });

  it("BackgroundError preserves name and message", () => {
    const err = new BackgroundError("boom");
    expect(err.name).toBe("BackgroundError");
    expect(err.message).toBe("boom");
  });
});

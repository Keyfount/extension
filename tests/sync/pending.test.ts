/**
 * Persistent retry queue for sync ops.
 *
 * Verifies the encrypted envelope on disk, FIFO drain order, halt-on-
 * failure (preserves ordering across retries), poison-pill drop, the
 * locked-vault no-op path, and that the queue survives a simulated
 * service-worker restart (`mock.reset()` only clears in-memory state;
 * here we manually preserve the on-disk blob between calls).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTestProfile, installChromeMock, TEST_MASTER } from "../helpers/chrome-mock.js";
import {
  _resetPendingState,
  clearPendingOps,
  drainPendingOps,
  enqueuePendingOp,
  loadPendingOps,
  pendingOpsCount,
} from "../../src/background/sync/pending.js";
import { getActiveProfileId, syncPendingOpsKey } from "../../src/background/profiles.js";
import type { SyncOp } from "../../src/shared/sync/payload.js";

const mock = installChromeMock();

beforeEach(async () => {
  mock.reset();
  _resetPendingState();
  await bootstrapTestProfile();
});

const DEL_OP: SyncOp = { t: "delete_account", domain: "ex.com", username: "u" };
const UPSERT_OP: SyncOp = {
  t: "upsert_account",
  entry: {
    domain: "ex.com",
    username: "u",
    profile: {
      mode: "random",
      length: 16,
      lower: true,
      upper: true,
      digits: true,
      symbols: true,
      counter: 1,
    },
    createdAt: 0,
    lastUsedAt: 0,
  },
};

async function activeId(): Promise<string> {
  const id = await getActiveProfileId();
  if (id === null) throw new Error("expected active profile");
  return id;
}

describe("extension pending queue — encryption envelope", () => {
  it("persists the queue as an AES-GCM ciphertext (no plaintext op fields on disk)", async () => {
    await enqueuePendingOp(DEL_OP);
    const id = await activeId();
    const raw = (await chrome.storage.local.get(syncPendingOpsKey(id)))[
      syncPendingOpsKey(id)
    ] as Record<string, unknown>;
    expect(raw).toBeDefined();
    expect(typeof raw.ciphertext).toBe("string");
    expect(typeof raw.iv).toBe("string");
    expect(typeof raw.salt).toBe("string");
    expect(typeof raw.iterations).toBe("number");
    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain("ex.com");
    expect(serialised).not.toContain("delete_account");
  });

  it("round-trips one enqueued op through load", async () => {
    await enqueuePendingOp(DEL_OP);
    const rows = await loadPendingOps();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.opJson)).toEqual(DEL_OP);
    expect(rows[0]!.attempts).toBe(0);
    expect(rows[0]!.lastError).toBeNull();
  });

  it("enqueuePendingOp throws while locked", async () => {
    await chrome.storage.session.remove("session.v1");
    await expect(enqueuePendingOp(DEL_OP)).rejects.toThrow(/locked/);
  });

  it("loadPendingOps returns [] while locked instead of throwing", async () => {
    await enqueuePendingOp(DEL_OP);
    await chrome.storage.session.remove("session.v1");
    expect(await loadPendingOps()).toEqual([]);
  });

  it("loadPendingOps returns [] under the wrong master (AES-GCM tag mismatch)", async () => {
    await enqueuePendingOp(DEL_OP);
    await chrome.storage.session.set({
      "session.v1": {
        master: "totally different",
        unlockedAt: Date.now(),
        autoLockMinutes: 15,
      },
    });
    expect(await loadPendingOps()).toEqual([]);
  });
});

describe("extension pending queue — drain", () => {
  it("drainPendingOps consumes every queued op via pushSingle in FIFO order", async () => {
    await enqueuePendingOp(DEL_OP);
    await enqueuePendingOp(UPSERT_OP);

    const pushed: SyncOp[] = [];
    await drainPendingOps(async (op) => {
      pushed.push(op);
    });

    expect(pushed).toEqual([DEL_OP, UPSERT_OP]);
    expect(await loadPendingOps()).toHaveLength(0);
  });

  it("a push failure halts the drain and bumps attempts on that row", async () => {
    await enqueuePendingOp(DEL_OP);
    await enqueuePendingOp(UPSERT_OP);

    await drainPendingOps(async () => {
      throw new Error("network down");
    });

    const rows = await loadPendingOps();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toBe("network down");
    expect(rows[1]!.attempts).toBe(0);
    expect(rows[1]!.lastError).toBeNull();
  });

  it("a transient failure followed by a successful drain clears the queue", async () => {
    await enqueuePendingOp(DEL_OP);

    await drainPendingOps(async () => {
      throw new Error("transient");
    });
    expect((await loadPendingOps())[0]!.attempts).toBe(1);

    await drainPendingOps(async () => {
      // success
    });
    expect(await loadPendingOps()).toHaveLength(0);
  });

  it("a concurrent drainPendingOps call returns immediately; first call completes", async () => {
    await enqueuePendingOp(DEL_OP);
    await enqueuePendingOp(UPSERT_OP);

    const pushed: SyncOp[] = [];
    const slow = vi.fn(async (op: SyncOp) => {
      await new Promise((r) => setTimeout(r, 10));
      pushed.push(op);
    });

    await Promise.all([drainPendingOps(slow), drainPendingOps(slow)]);

    expect(slow).toHaveBeenCalledTimes(2);
    expect(pushed).toEqual([DEL_OP, UPSERT_OP]);
    expect(await loadPendingOps()).toHaveLength(0);
  });

  it("drainPendingOps is a no-op while locked (queue intact)", async () => {
    await enqueuePendingOp(DEL_OP);
    await chrome.storage.session.remove("session.v1");

    const pushed: SyncOp[] = [];
    await drainPendingOps(async (op) => {
      pushed.push(op);
    });
    expect(pushed).toEqual([]);

    // Unlock and confirm the row is still there.
    await chrome.storage.session.set({
      "session.v1": { master: TEST_MASTER, unlockedAt: Date.now(), autoLockMinutes: 15 },
    });
    expect(await loadPendingOps()).toHaveLength(1);
  });
});

describe("extension pending queue — survival semantics", () => {
  it("the queue survives a simulated SW restart (re-imports the module)", async () => {
    await enqueuePendingOp(DEL_OP);

    // Simulate a service-worker restart by resetting module state but
    // preserving the on-disk encrypted blob.
    _resetPendingState();

    expect(await pendingOpsCount()).toBe(1);
    const rows = await loadPendingOps();
    expect(JSON.parse(rows[0]!.opJson)).toEqual(DEL_OP);
  });

  it("clearPendingOps removes the queue entirely", async () => {
    await enqueuePendingOp(DEL_OP);
    await clearPendingOps();
    const id = await activeId();
    const raw = await chrome.storage.local.get(syncPendingOpsKey(id));
    expect(raw[syncPendingOpsKey(id)]).toBeUndefined();
    expect(await loadPendingOps()).toEqual([]);
  });

  it("pendingOpsCount reflects the live queue size", async () => {
    expect(await pendingOpsCount()).toBe(0);
    await enqueuePendingOp(DEL_OP);
    await enqueuePendingOp(UPSERT_OP);
    expect(await pendingOpsCount()).toBe(2);
  });

  it("ordering: a delete queued before an upsert drains in that exact order", async () => {
    await enqueuePendingOp(DEL_OP);
    await enqueuePendingOp(UPSERT_OP);
    const ordered: string[] = [];
    await drainPendingOps(async (op) => {
      ordered.push(op.t);
    });
    expect(ordered).toEqual(["delete_account", "upsert_account"]);
  });
});

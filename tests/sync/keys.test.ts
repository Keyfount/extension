import { describe, it, expect } from "vitest";

import {
  bytesToBase64Url,
  bytesToHex,
  deriveMasterKey,
  deriveSaltSync,
  hexToUint8,
  lkToPassword,
  splitMasterKey,
} from "../../src/shared/sync/keys.js";

describe("sync key derivation", () => {
  it("is deterministic for the same inputs", async () => {
    const salt = new Uint8Array(16).fill(7);
    const mkA = await deriveMasterKey("hunter2", "alice@example.com", salt);
    const mkB = await deriveMasterKey("hunter2", "alice@example.com", salt);
    expect(bytesToHex(mkA)).toBe(bytesToHex(mkB));
  });

  it("changes when the master changes", async () => {
    const salt = new Uint8Array(16).fill(7);
    const mkA = await deriveMasterKey("hunter2", "alice@example.com", salt);
    const mkB = await deriveMasterKey("hunter3", "alice@example.com", salt);
    expect(bytesToHex(mkA)).not.toBe(bytesToHex(mkB));
  });

  it("changes when the email changes (domain separation)", async () => {
    const salt = new Uint8Array(16).fill(7);
    const mkA = await deriveMasterKey("hunter2", "alice@example.com", salt);
    const mkB = await deriveMasterKey("hunter2", "bob@example.com", salt);
    expect(bytesToHex(mkA)).not.toBe(bytesToHex(mkB));
  });

  it("changes when the salt changes (per-server separation)", async () => {
    const mkA = await deriveMasterKey("pw", "a@b.c", new Uint8Array(16).fill(1));
    const mkB = await deriveMasterKey("pw", "a@b.c", new Uint8Array(16).fill(2));
    expect(bytesToHex(mkA)).not.toBe(bytesToHex(mkB));
  });

  it("produces independent EK and LK via HKDF info labels", async () => {
    const salt = new Uint8Array(16).fill(7);
    const mk = await deriveMasterKey("pw", "a@b.c", salt);
    const { ek, lk } = await splitMasterKey(mk, new Uint8Array(16));
    expect(ek).toHaveLength(32);
    expect(lk).toHaveLength(32);
    // EK and LK must differ — the whole point of domain separation.
    expect(bytesToHex(ek)).not.toBe(bytesToHex(lk));
  });

  it("base64url encoding is URL-safe (no +/=)", () => {
    const bytes = new Uint8Array([255, 254, 253, 252, 251]);
    const b64 = bytesToBase64Url(bytes);
    expect(b64).not.toMatch(/[+/=]/);
  });

  it("lkToPassword encodes LK bytes losslessly", () => {
    const lk = new Uint8Array(32).map((_, i) => i);
    const pw = lkToPassword(lk);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pw.length).toBeGreaterThan(40);
  });

  it("deriveSaltSync is deterministic for the same (email, baseUrl)", async () => {
    const a = await deriveSaltSync("alice@example.com", "https://sync.example.com");
    const b = await deriveSaltSync("alice@example.com", "https://sync.example.com");
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(a).toHaveLength(16);
  });

  it("deriveSaltSync changes when the email changes", async () => {
    const a = await deriveSaltSync("alice@example.com", "https://sync.example.com");
    const b = await deriveSaltSync("bob@example.com", "https://sync.example.com");
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("deriveSaltSync changes when the server URL changes", async () => {
    const a = await deriveSaltSync("alice@example.com", "https://sync.a.example.com");
    const b = await deriveSaltSync("alice@example.com", "https://sync.b.example.com");
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("deriveSaltSync normalises email case + trims server trailing slashes", async () => {
    const a = await deriveSaltSync("Alice@Example.com", "https://sync.example.com/");
    const b = await deriveSaltSync("  alice@example.com", "https://sync.example.com");
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("hexToUint8 round-trips with bytesToHex", () => {
    const original = new Uint8Array([0x00, 0xff, 0x10, 0x20, 0x80]);
    const hex = bytesToHex(original);
    expect(hex).toBe("00ff102080");
    const back = hexToUint8(hex);
    expect(Array.from(back)).toEqual(Array.from(original));
  });
});

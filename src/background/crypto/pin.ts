/**
 * PIN-protected at-rest storage of the master password.
 *
 * Opt-in only — when the user activates PIN mode, the master is encrypted
 * with AES-GCM using a key derived from the PIN via PBKDF2-SHA256
 * (600,000 iterations, OWASP 2023). The ciphertext, IV and salt are then
 * stored in chrome.storage.local.
 *
 * The PIN itself is *low-entropy* (4 to 6 digits) so the threshold of
 * defence is the PBKDF2 work factor. An attacker who exfiltrates the blob
 * still needs to brute-force the PIN against PBKDF2 — feasible for a
 * dedicated adversary, which is why we surface a clear warning at opt-in.
 */
import type { PinBlob } from "../storage.js";

export const PIN_PBKDF2_ITERATIONS = 600_000 as const;
const KEY_LENGTH = 256 as const;
const SALT_LENGTH = 16 as const;
const IV_LENGTH = 12 as const;

/** Encrypt the master with a key derived from the PIN. */
export async function encryptMaster(master: string, pin: string): Promise<PinBlob> {
  assertPin(pin);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(master) as BufferSource,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: PIN_PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypt the master using a candidate PIN. Returns `null` when the PIN is
 * wrong (AES-GCM tag mismatch) — never throws on a bad PIN to avoid leaking
 * the failure cause.
 */
export async function decryptMaster(blob: PinBlob, pin: string): Promise<string | null> {
  assertPin(pin);
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const key = await deriveKey(pin, salt, blob.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

function assertPin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error("PIN must be 4 to 6 digits");
  }
}

/**
 * Derive an AES-GCM key from a secret (PIN, master password, …) via
 * PBKDF2-SHA256. Shared by the PIN blob and the encrypted accounts list.
 */
export async function deriveAesGcmKey(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: number = PIN_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  return deriveAesGcmKey(pin, salt, iterations);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * AES-GCM helpers used to encrypt and decrypt sync events / snapshots.
 * Nothing here is sync-protocol-specific — just a clean wrapper over
 * WebCrypto so callers don't repeat the same boilerplate.
 */

const NONCE_BYTES = 12;

/** Lift a 32-byte key into a CryptoKey usable by WebCrypto. */
export async function importAesGcmKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== 32) {
    throw new Error(`expected 32-byte key, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface EncryptResult {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptResult> {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext: new Uint8Array(cipher), nonce };
}

export async function decryptJson<T>(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

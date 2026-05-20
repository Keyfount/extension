/**
 * Argon2id key derivation.
 *
 * Parameters are pinned for the lifetime of v1 — changing any value here would
 * silently invalidate every password ever generated. See § 12 of the design
 * spec for the migration policy.
 */
import { argon2id } from "hash-wasm";

export const ARGON2_PARAMS = {
  /** Memory cost in KiB. 64 MiB. */
  memorySize: 65536,
  /** Time cost (number of iterations). */
  iterations: 3,
  /** Parallelism. */
  parallelism: 1,
  /** Derived key length in bytes. */
  hashLength: 32,
} as const;

/**
 * Derive a 32-byte secret from the master password and a salt.
 *
 * The output is returned as a `Uint8Array` so the caller can interpret it as a
 * big integer for the rendering step.
 */
export async function deriveBits(master: string, salt: Uint8Array): Promise<Uint8Array> {
  const hex = await argon2id({
    password: master,
    salt,
    parallelism: ARGON2_PARAMS.parallelism,
    iterations: ARGON2_PARAMS.iterations,
    memorySize: ARGON2_PARAMS.memorySize,
    hashLength: ARGON2_PARAMS.hashLength,
    outputType: "hex",
  });

  return hexToBytes(hex);
}

/**
 * Build the canonical salt for a derivation: `domain || email || counterHex`.
 *
 * The inputs are concatenated with no separator. `domain` and `email` are
 * expected to be already normalised (lower-cased, trimmed) by the caller.
 */
export function buildSalt(domain: string, email: string, counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`counter must be a positive integer, got ${counter}`);
  }
  const text = `${domain}${email}${counter.toString(16)}`;
  return new TextEncoder().encode(text);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("invalid hex string");
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Convert a byte sequence into a `bigint`, big-endian. The result is the
 * mathematical integer represented by the bytes.
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

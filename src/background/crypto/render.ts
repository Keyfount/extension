/**
 * Deterministic password rendering — Random Characters mode.
 *
 * Given an arbitrary-precision integer of entropy and a profile describing
 * which character classes to include, produce a password of the requested
 * length that contains at least one character from each enabled class.
 *
 * The algorithm is a deterministic base conversion: we repeatedly divide the
 * entropy by the size of the active character pool and use the remainder as
 * the index of the next character. Required-class characters are then
 * inserted at deterministic positions to guarantee class coverage.
 */
import type { RandomProfile } from "../../shared/types.js";

export const POOL_LOWER = "abcdefghijklmnopqrstuvwxyz";
export const POOL_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const POOL_DIGITS = "0123456789";
export const POOL_SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

interface EnabledPools {
  pools: readonly string[];
  combined: string;
}

function enabledPools(profile: RandomProfile): EnabledPools {
  const pools: string[] = [];
  if (profile.lower) pools.push(POOL_LOWER);
  if (profile.upper) pools.push(POOL_UPPER);
  if (profile.digits) pools.push(POOL_DIGITS);
  if (profile.symbols) pools.push(POOL_SYMBOLS);

  if (pools.length === 0) {
    throw new Error("at least one character class must be enabled");
  }

  return { pools, combined: pools.join("") };
}

/**
 * Consume `length` characters from `entropy` by repeated `divmod(pool.length)`,
 * appending the character at the remainder index. Returns the consumed string
 * and the remaining entropy.
 */
export function consumeEntropy(
  entropy: bigint,
  pool: string,
  length: number,
): { consumed: string; remaining: bigint } {
  const poolSize = BigInt(pool.length);
  let value = entropy;
  let out = "";
  for (let i = 0; i < length; i++) {
    const remainder = Number(value % poolSize);
    value /= poolSize;

    out += pool[remainder]!;
  }
  return { consumed: out, remaining: value };
}

/**
 * Insert each character of `extra` into `base` at a deterministically derived
 * position, consuming entropy as we go.
 */
export function insertPseudoRandomly(
  base: string,
  extra: string,
  entropy: bigint,
): { result: string; remaining: bigint } {
  let result = base;
  let value = entropy;
  for (const char of extra) {
    const positionCount = BigInt(result.length + 1);
    const position = Number(value % positionCount);
    value /= positionCount;
    result = result.slice(0, position) + char + result.slice(position);
  }
  return { result, remaining: value };
}

/**
 * Render a Random Characters password from an entropy integer.
 *
 * Throws if the requested length is shorter than the number of enabled rules
 * (we cannot guarantee one character per class otherwise) or out of range.
 */
export function renderRandom(entropy: bigint, profile: RandomProfile): string {
  if (!Number.isInteger(profile.length) || profile.length < 5 || profile.length > 35) {
    throw new RangeError(`profile.length must be between 5 and 35, got ${profile.length}`);
  }

  const { pools, combined } = enabledPools(profile);
  if (profile.length < pools.length) {
    throw new RangeError(
      `length ${profile.length} too short to satisfy ${pools.length} enabled classes`,
    );
  }

  const bulk = consumeEntropy(entropy, combined, profile.length - pools.length);

  let entropyAfter = bulk.remaining;
  let oneOfEach = "";
  for (const pool of pools) {
    const step = consumeEntropy(entropyAfter, pool, 1);
    oneOfEach += step.consumed;
    entropyAfter = step.remaining;
  }

  const inserted = insertPseudoRandomly(bulk.consumed, oneOfEach, entropyAfter);
  return inserted.result;
}

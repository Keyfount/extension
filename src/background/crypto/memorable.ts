/**
 * Memorable password rendering.
 *
 * Produces a passphrase of N words drawn from the EFF Large Wordlist,
 * separated by a single character, optionally with one word capitalised and an
 * optional `<digit><symbol>` suffix to satisfy dumb complexity validators.
 *
 * With the default of 6 words, output entropy is approximately
 * `6 * log2(7776) ≈ 77.5 bits` — above the 70-bit project target.
 */
import type { MemorableProfile } from "../../shared/types.js";
import { consumeEntropy } from "./render.js";
import { EFF_LARGE_WORDLIST, EFF_LARGE_WORDLIST_SIZE } from "./wordlist.js";

const SUFFIX_DIGITS = "0123456789";
const SUFFIX_SYMBOLS = "!@#$%^&*?";

export function renderMemorable(entropy: bigint, profile: MemorableProfile): string {
  if (!Number.isInteger(profile.wordCount) || profile.wordCount < 5 || profile.wordCount > 8) {
    throw new RangeError(`profile.wordCount must be between 5 and 8, got ${profile.wordCount}`);
  }

  const poolSize = BigInt(EFF_LARGE_WORDLIST_SIZE);
  let value = entropy;

  const words: string[] = [];
  for (let i = 0; i < profile.wordCount; i++) {
    const index = Number(value % poolSize);
    value /= poolSize;

    words.push(EFF_LARGE_WORDLIST[index]!);
  }

  if (profile.capitalise) {
    const positionCount = BigInt(words.length);
    const position = Number(value % positionCount);
    value /= positionCount;

    const word = words[position]!;
    words[position] = word.charAt(0).toUpperCase() + word.slice(1);
  }

  let result = words.join(profile.separator);

  if (profile.suffix) {
    const digit = consumeEntropy(value, SUFFIX_DIGITS, 1);
    const symbol = consumeEntropy(digit.remaining, SUFFIX_SYMBOLS, 1);
    result += digit.consumed + symbol.consumed;
  }

  return result;
}

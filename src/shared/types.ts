/**
 * Per-site password generation profile.
 *
 * A profile is what differs from one site to another: which mode to use, how
 * long the password should be, which character classes to include, and the
 * counter used to rotate a compromised password.
 */
export type Profile = RandomProfile | MemorableProfile;

export interface RandomProfile {
  mode: "random";
  /** Total password length. Must be between 5 and 35 inclusive. */
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Rotation counter. Must be >= 1. */
  counter: number;
}

export interface MemorableProfile {
  mode: "memorable";
  /** Number of words. Must be between 5 and 8 inclusive. */
  wordCount: number;
  separator: "-" | "." | "_";
  /** Capitalise one word at a deterministic position. */
  capitalise: boolean;
  /** Append a deterministic <digit><symbol> suffix. */
  suffix: boolean;
  /** Rotation counter. Must be >= 1. */
  counter: number;
}

/**
 * The three deterministic inputs that, together with a profile, produce a
 * password.
 */
export interface DerivationInputs {
  master: string;
  domain: string;
  email: string;
}

/** Default profile used at first install. */
export const DEFAULT_RANDOM_PROFILE: RandomProfile = {
  mode: "random",
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  counter: 1,
};

export const DEFAULT_MEMORABLE_PROFILE: MemorableProfile = {
  mode: "memorable",
  wordCount: 6,
  // We default to "." rather than "-" because four words in the EFF Large
  // Wordlist already contain hyphens (drop-down, felt-tip, t-shirt, yo-yo) —
  // mixing them with "-" as a separator would make the output ambiguous to
  // read or dictate.
  separator: ".",
  capitalise: true,
  suffix: true,
  counter: 1,
};

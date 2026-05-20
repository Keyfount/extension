/**
 * High-level password derivation façade.
 *
 * This is the single entry point used by the service worker. It is responsible
 * for input normalisation, salt construction, calling Argon2id, and
 * dispatching to the appropriate rendering module.
 *
 * Keeping all the orchestration here lets the unit modules (`argon2`,
 * `render`, `memorable`) stay pure and easy to test against golden vectors.
 */
import type { DerivationInputs, Profile } from "../../shared/types.js";
import { buildSalt, bytesToBigInt, deriveBits } from "./argon2.js";
import { renderMemorable } from "./memorable.js";
import { renderRandom } from "./render.js";

export interface DeriveOptions {
  inputs: DerivationInputs;
  profile: Profile;
}

/**
 * Normalise the derivation inputs. The master is used verbatim; the domain
 * and email are lowercased and trimmed.
 *
 * The caller is expected to have already reduced the URL to its registrable
 * domain using the Public Suffix List — we do not do TLD parsing here to keep
 * this module dependency-free.
 */
export function normaliseInputs(inputs: DerivationInputs): DerivationInputs {
  return {
    master: inputs.master,
    domain: inputs.domain.trim().toLowerCase(),
    email: inputs.email.trim().toLowerCase(),
  };
}

/**
 * Derive a password from the given inputs and profile.
 *
 * The function is intentionally async — Argon2id is a memory-hard operation
 * that takes hundreds of milliseconds on a modern laptop. Callers should
 * display a spinner.
 */
export async function derivePassword({ inputs, profile }: DeriveOptions): Promise<string> {
  if (inputs.master.length === 0) {
    throw new Error("master password must not be empty");
  }
  if (inputs.domain.length === 0) {
    throw new Error("domain must not be empty");
  }

  const normalised = normaliseInputs(inputs);
  const salt = buildSalt(normalised.domain, normalised.email, profile.counter);
  const bytes = await deriveBits(normalised.master, salt);
  const entropy = bytesToBigInt(bytes);

  return profile.mode === "random"
    ? renderRandom(entropy, profile)
    : renderMemorable(entropy, profile);
}

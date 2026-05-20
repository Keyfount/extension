/**
 * Popup-wide reactive state, backed by `@preact/signals`.
 *
 * Centralising the signals avoids prop-drilling and lets any component read
 * the latest values without re-renders cascading through the tree.
 */
import { computed, signal } from "@preact/signals";

export type Screen = "loading" | "setup" | "unlock" | "main";

export const screen = signal<Screen>("loading");

/** Fingerprint of the master, set after setup or unlock. */
export const fingerprint = signal<string | null>(null);

/** Live fingerprint preview during master typing on the setup screen. */
export const livePreview = signal<string | null>(null);

/** Active tab's registrable domain. `null` if the tab is not a normal web page. */
export const activeDomain = signal<string | null>(null);

/** Email read from the page or typed in the popup. */
export const activeEmail = signal<string>("");

/** Generated password for the current (domain, email) combo. */
export const generated = signal<string | null>(null);

/** A transient busy flag — set whenever a background call is in flight. */
export const busy = signal<boolean>(false);

/** Last error to surface in the UI. Cleared when the user takes any action. */
export const errorMessage = signal<string | null>(null);

/** Whether the user has enabled PIN unlock. */
export const hasPin = signal<boolean>(false);

export const canGenerate = computed(
  () => activeDomain.value !== null && activeEmail.value.trim().length > 0,
);

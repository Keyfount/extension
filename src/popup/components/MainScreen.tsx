import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send } from "../api.js";
import { Header } from "./Header.js";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLock,
  IconSettings,
} from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { ProfileEditor } from "../../shared/ProfileEditor.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { Profile } from "../../shared/types.js";
import {
  activeDomain,
  activeEmail,
  busy,
  canGenerate,
  errorMessage,
  fingerprint,
  generated,
  screen,
} from "../state.js";

export function MainScreen() {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    generated.value = null;
    setRevealed(false);
    setCopied(false);
    setProfile(null);
    setShowProfile(false);
  }, [activeDomain.value, activeEmail.value]);

  // Lazy-load the per-site profile when the user opens the customise panel.
  useEffect(() => {
    if (!showProfile || profile !== null || activeDomain.value === null) return;
    let cancelled = false;
    void send({ kind: "getProfile", domain: activeDomain.value }).then(
      (response) => {
        if (!cancelled) setProfile(response.profile);
      },
      () => {
        // ignore — generate still works with the default
      },
    );
    return () => {
      cancelled = true;
    };
  }, [showProfile, profile, activeDomain.value]);

  const generate = useCallback(async () => {
    if (activeDomain.value === null) return;
    errorMessage.value = null;
    busy.value = true;
    try {
      const response = await send({
        kind: "generate",
        domain: activeDomain.value,
        email: activeEmail.value.trim(),
        ...(profile !== null ? { profile } : {}),
      });
      generated.value = response.password;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "generation failed";
    } finally {
      busy.value = false;
    }
  }, [profile]);

  const updateProfile = useCallback(async (next: Profile) => {
    setProfile(next);
    generated.value = null;
    if (activeDomain.value !== null) {
      try {
        await send({ kind: "setProfile", domain: activeDomain.value, profile: next });
      } catch {
        // swallowed — the next generate will still use the in-memory next
      }
    }
  }, []);

  const copy = useCallback(async () => {
    if (generated.value === null) return;
    try {
      await navigator.clipboard.writeText(generated.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // swallowed — clipboard API may be unavailable
    }
  }, []);

  const onLock = useCallback(async () => {
    await send({ kind: "lock" });
    generated.value = null;
    screen.value = "unlock";
  }, []);

  const onSettings = useCallback(() => {
    screen.value = "settings";
  }, []);

  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={activeDomain.value ?? undefined}
        fingerprint={fingerprint.value}
        actions={
          <>
            <motion.button
              type="button"
              class="btn btn-quiet btn-icon"
              whileTap={TAP_SCALE}
              onClick={onSettings}
              aria-label={t("common_settings")}
            >
              <IconSettings />
            </motion.button>
            <motion.button
              type="button"
              class="btn btn-quiet btn-icon"
              whileTap={TAP_SCALE}
              onClick={onLock}
              aria-label={t("common_lock")}
            >
              <IconLock />
            </motion.button>
          </>
        }
      />

      {activeDomain.value === null ? (
        <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("main_no_site")}</p>
      ) : (
        <>
          <label class="flex flex-col gap-2">
            <span class="field-label">{t("main_username_label")}</span>
            <input
              class="input"
              type="text"
              value={activeEmail.value}
              autocomplete="off"
              placeholder={t("main_username_placeholder")}
              onInput={(e) => {
                activeEmail.value = (e.target as HTMLInputElement).value;
              }}
            />
          </label>

          <motion.button
            type="button"
            class="btn"
            whileTap={TAP_SCALE}
            onClick={generate}
            disabled={busy.value || !canGenerate.value}
          >
            {busy.value ? t("common_generating") : t("common_generate")}
          </motion.button>

          <div class="flex flex-col">
            <button
              type="button"
              class="flex items-center justify-between gap-2 py-1.5 px-1 text-xs text-(--color-ink-muted) hover:text-(--color-ink) transition-colors cursor-pointer bg-transparent border-0 font-medium"
              onClick={() => setShowProfile((v) => !v)}
              aria-expanded={showProfile}
            >
              <span>{t("badge_customize")}</span>
              <motion.span
                animate={{ rotate: showProfile ? 180 : 0 }}
                transition={SOFT_SPRING}
                class="grid place-items-center"
              >
                <IconChevronDown size={14} />
              </motion.span>
            </button>
            <AnimatePresence>
              {showProfile ? (
                <motion.div
                  key="profile"
                  class="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1, transition: SOFT_SPRING }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
                >
                  <div class="pt-3 pb-1">
                    {profile !== null ? (
                      <ProfileEditor profile={profile} onChange={updateProfile} compact />
                    ) : (
                      <div class="flex flex-col gap-2">
                        <div class="skeleton h-7 w-full" />
                        <div class="skeleton h-4 w-2/3" />
                        <div class="skeleton h-4 w-full" />
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {generated.value !== null ? (
              <motion.div
                key="generated"
                class="flex flex-col gap-3 p-4 rounded-[10px] bg-(--color-surface-sunken) border border-(--color-line)"
                variants={POP_IN}
                initial="initial"
                animate="animate"
                exit="exit"
                layout
              >
                <code
                  class={
                    revealed
                      ? "font-mono text-sm break-all select-all cursor-text text-(--color-ink) min-h-5"
                      : "font-mono text-sm break-all select-all cursor-text text-(--color-ink-muted) min-h-5 tracking-[0.15em]"
                  }
                >
                  {revealed ? generated.value : "•".repeat(Math.min(generated.value.length, 24))}
                </code>
                <div class="flex gap-2">
                  <motion.button
                    type="button"
                    class="btn btn-ghost btn-sm flex-1"
                    whileTap={TAP_SCALE}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                    {revealed ? t("common_hide") : t("common_reveal")}
                  </motion.button>
                  <motion.button
                    type="button"
                    class="btn btn-ghost btn-sm flex-1"
                    whileTap={TAP_SCALE}
                    onClick={copy}
                  >
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {copied ? t("common_copied") : t("common_copy")}
                  </motion.button>
                </div>
              </motion.div>
            ) : !canGenerate.value ? (
              <p class="field-hint">{t("main_no_email")}</p>
            ) : null}
          </AnimatePresence>

          {errorMessage.value !== null ? (
            <div class="field-error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </>
      )}
    </motion.div>
  );
}

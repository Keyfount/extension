import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send } from "../api.js";
import { Header } from "./Header.js";
import { t } from "../../shared/i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import {
  busy,
  errorMessage,
  fingerprint as fingerprintSignal,
  hasPin as hasPinSignal,
  historyEnabled,
  livePreview,
  screen,
} from "../state.js";
import { loadVaultData } from "../vault.js";

const MIN_LENGTH = 12;

export function SetupScreen() {
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"master" | "history">("master");
  const [hasOtherVaults, setHasOtherVaults] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decide whether to offer an "Annuler" escape — only useful if there is
  // at least one *other* profile we could fall back to.
  useEffect(() => {
    let cancelled = false;
    void send({ kind: "listVaults" }).then(
      (res) => {
        if (!cancelled) setHasOtherVaults(res.vaults.length > 0);
      },
      () => {
        /* swallow */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const cancelToExisting = useCallback(async () => {
    try {
      const res = await send({ kind: "listVaults" });
      const fallback = [...res.vaults].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
      if (fallback === undefined) return;
      await send({ kind: "switchVault", id: fallback.id });
      const status = await send({ kind: "status" });
      fingerprintSignal.value = status.fingerprint;
      hasPinSignal.value = status.hasPin;
      screen.value = status.isFirstRun ? "setup" : "unlock";
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "could not switch back";
    }
  }, []);

  useEffect(() => {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    if (master.length < MIN_LENGTH) {
      livePreview.value = null;
      return;
    }
    previewTimer.current = setTimeout(() => {
      void send({ kind: "fingerprint", master }).then(
        (response) => {
          livePreview.value = response.fingerprint;
        },
        () => {
          livePreview.value = null;
        },
      );
    }, 500);
    return () => {
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    };
  }, [master]);

  const submit = useCallback(
    async (event: Event) => {
      event.preventDefault();
      errorMessage.value = null;
      if (master.length < MIN_LENGTH) {
        errorMessage.value = t("setup_min_length_error", String(MIN_LENGTH));
        return;
      }
      if (master !== confirm) {
        errorMessage.value = t("setup_mismatch_error");
        return;
      }
      busy.value = true;
      try {
        const response = await send({ kind: "setup", master });
        fingerprintSignal.value = response.fingerprint;
        setStep("history");
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "setup failed";
      } finally {
        busy.value = false;
      }
    },
    [master, confirm],
  );

  if (step === "history") {
    return (
      <motion.div
        class="flex flex-col gap-4 p-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT_SPRING}
      >
        <Header subtitle={t("history_setup_title")} />
        <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("history_setup_body")}</p>
        <div class="flex gap-2">
          <motion.button
            type="button"
            class="btn flex-1"
            whileTap={TAP_SCALE}
            onClick={async () => {
              await send({ kind: "setHistoryEnabled", enabled: true });
              historyEnabled.value = true;
              await loadVaultData();
              screen.value = "main";
            }}
          >
            {t("history_setup_enable")}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-ghost flex-1"
            whileTap={TAP_SCALE}
            onClick={async () => {
              await loadVaultData();
              screen.value = "main";
            }}
          >
            {t("history_setup_skip")}
          </motion.button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.form
      class="flex flex-col gap-4 p-5"
      onSubmit={submit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header subtitle={t("setup_welcome")} />

      <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("setup_intro")}</p>

      <label class="flex flex-col gap-2">
        <span class="field-label">{t("setup_master_label")}</span>
        <input
          class="input"
          type="password"
          value={master}
          minLength={MIN_LENGTH}
          required
          autocomplete="new-password"
          onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="flex flex-col gap-2">
        <span class="field-label">{t("setup_confirm_label")}</span>
        <input
          class="input"
          type="password"
          value={confirm}
          autocomplete="new-password"
          onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        />
      </label>

      <AnimatePresence>
        {livePreview.value !== null ? (
          <motion.div
            key="preview"
            class="flex flex-col gap-2 items-start p-4 rounded-[10px] bg-(--color-surface-sunken) border border-(--color-line)"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
            aria-live="polite"
          >
            <span class="fingerprint">{livePreview.value}</span>
            <span class="field-hint">{t("setup_fingerprint_hint")}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {errorMessage.value !== null ? (
          <motion.div
            key="error"
            class="field-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
          >
            {errorMessage.value}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button type="submit" class="btn" whileTap={TAP_SCALE} disabled={busy.value}>
        {busy.value ? t("setup_creating") : t("setup_create_button")}
      </motion.button>

      {hasOtherVaults ? (
        <motion.button
          type="button"
          class="btn btn-ghost"
          whileTap={TAP_SCALE}
          onClick={() => void cancelToExisting()}
          disabled={busy.value}
        >
          {t("setup_cancel_existing")}
        </motion.button>
      ) : null}
    </motion.form>
  );
}

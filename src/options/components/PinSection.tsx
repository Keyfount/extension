import { useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { BackgroundError, send } from "../api.js";
import { IconShield } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";

interface Props {
  hasPin: boolean;
  onChange: () => Promise<void>;
}

export function PinSection({ hasPin, onChange }: Props) {
  const [confirmingEnable, setConfirmingEnable] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      await send({ kind: "setPin", pin });
      setConfirmingEnable(false);
      setPin("");
      await onChange();
    } catch (e) {
      setError(e instanceof BackgroundError ? e.message : "could not set the PIN");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await send({ kind: "removePin" });
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <div class="flex flex-col gap-0.5 flex-1">
          <h2 class="m-0 text-base font-semibold tracking-[-0.015em]">
            {t("options_pin_section")}
          </h2>
          <span class="text-xs text-(--color-ink-muted) leading-snug">{t("options_pin_hint")}</span>
        </div>
      </div>

      <div class="card p-6 shadow-sm">
        <div class="callout">
          <span class="text-amber-600 dark:text-amber-400 shrink-0 mt-px">
            <IconShield size={16} />
          </span>
          <span>{t("options_pin_warning")}</span>
        </div>

        <AnimatePresence mode="wait">
          {hasPin ? (
            <motion.div
              key="active"
              class="flex items-center justify-between gap-4"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <span class="text-sm font-medium">{t("options_pin_enabled")}</span>
              <motion.button
                class="btn btn-danger btn-sm"
                type="button"
                whileTap={TAP_SCALE}
                disabled={busy}
                onClick={disable}
              >
                {t("options_pin_remove")}
              </motion.button>
            </motion.div>
          ) : confirmingEnable ? (
            <motion.div
              key="form"
              class="flex flex-col gap-4"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <label class="flex flex-col gap-2">
                <span class="field-label">{t("options_pin_choose")}</span>
                <input
                  class="input input-mono tracking-widest text-center"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={4}
                  maxLength={6}
                  autoFocus
                  value={pin}
                  onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
                />
              </label>
              <div class="flex gap-2">
                <motion.button
                  type="button"
                  class="btn"
                  whileTap={TAP_SCALE}
                  disabled={busy || pin.length < 4}
                  onClick={enable}
                >
                  {busy ? t("options_pin_saving") : t("options_pin_confirm_enable")}
                </motion.button>
                <motion.button
                  class="btn btn-ghost"
                  type="button"
                  whileTap={TAP_SCALE}
                  onClick={() => {
                    setConfirmingEnable(false);
                    setPin("");
                    setError(null);
                  }}
                >
                  {t("common_cancel")}
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="enable"
              class="btn btn-ghost btn-sm self-start"
              type="button"
              whileTap={TAP_SCALE}
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={() => setConfirmingEnable(true)}
            >
              {t("options_pin_enable")}
            </motion.button>
          )}
        </AnimatePresence>

        {error !== null ? (
          <div class="field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}

import { useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";

interface Props {
  onChange: () => Promise<void>;
}

export function DangerSection({ onChange }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await send({ kind: "wipe" });
      setConfirming(false);
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
            {t("options_danger_section")}
          </h2>
          <span class="text-xs text-(--color-ink-muted) leading-snug">
            {t("options_danger_hint")}
          </span>
        </div>
      </div>
      <div class="card p-6 shadow-sm border-red-300/50 dark:border-red-500/30">
        <AnimatePresence mode="wait">
          {confirming ? (
            <motion.div
              key="confirm"
              class="flex gap-2"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <motion.button
                type="button"
                class="btn btn-danger"
                whileTap={TAP_SCALE}
                disabled={busy}
                onClick={wipe}
              >
                {busy ? t("options_danger_wiping") : t("options_danger_confirm")}
              </motion.button>
              <motion.button
                class="btn btn-ghost"
                type="button"
                whileTap={TAP_SCALE}
                onClick={() => setConfirming(false)}
              >
                {t("common_cancel")}
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              class="flex justify-between items-center gap-4"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <span class="text-sm font-medium">{t("options_danger_reset")}</span>
              <motion.button
                class="btn btn-danger btn-sm"
                type="button"
                whileTap={TAP_SCALE}
                onClick={() => setConfirming(true)}
              >
                {t("options_danger_reset")}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

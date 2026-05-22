import type { JSX } from "preact";
import { motion } from "framer-motion";
import { Logo } from "../../shared/Logo.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import { screen } from "../state.js";

interface Props {
  subtitle?: string | undefined;
  fingerprint?: string | null | undefined;
  actions?: JSX.Element | undefined;
  /**
   * When true, the fingerprint chip becomes a button that opens the vaults
   * screen. Defaults to true wherever a fingerprint is shown — opt out on
   * the vaults screen itself to avoid a tap that does nothing.
   */
  fingerprintIsSwitcher?: boolean;
}

/** Common popup header with the brand glyph + an optional subtitle/actions. */
export function Header({ subtitle, fingerprint, actions, fingerprintIsSwitcher = true }: Props) {
  return (
    <header class="flex items-center justify-between gap-3">
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <motion.span
            class="grid place-items-center text-(--color-accent-600) dark:text-(--color-accent-400)"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={SOFT_SPRING}
          >
            <Logo size={20} />
          </motion.span>
          <span class="font-semibold tracking-[-0.015em] text-sm text-(--color-ink)">
            {t("extName")}
          </span>
          {fingerprint !== undefined && fingerprint !== null ? (
            fingerprintIsSwitcher ? (
              <motion.button
                type="button"
                class="fingerprint fingerprint-sm ml-1 cursor-pointer border-0 bg-transparent p-0"
                title="Changer de profil"
                aria-label="Ouvrir la liste des profils"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...SOFT_SPRING, delay: 0.05 }}
                whileTap={TAP_SCALE}
                onClick={() => {
                  screen.value = "vaults";
                }}
              >
                {fingerprint}
              </motion.button>
            ) : (
              <motion.span
                class="fingerprint fingerprint-sm ml-1"
                title={t("unlock_expected_label")}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...SOFT_SPRING, delay: 0.05 }}
              >
                {fingerprint}
              </motion.span>
            )
          ) : null}
        </div>
        {subtitle !== undefined ? (
          <span class="text-xs text-(--color-ink-muted) truncate">{subtitle}</span>
        ) : null}
      </div>
      {actions !== undefined ? <div class="flex gap-1 shrink-0">{actions}</div> : null}
    </header>
  );
}

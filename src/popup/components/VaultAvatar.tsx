/**
 * Round button that surfaces the active profile's first emoji and opens the
 * vaults screen on tap. Replaces the older "click the fingerprint chip"
 * affordance — the avatar is much easier to spot and to hit.
 *
 * Rendered wherever a profile identity is in play: main screen, unlock,
 * settings, sync, account detail.
 */
import { motion } from "framer-motion";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import { screen } from "../state.js";

interface Props {
  fingerprint: string;
}

/** Return the first emoji of a space-joined fingerprint, or "?" on bad input. */
export function firstEmoji(fingerprint: string): string {
  const parts = fingerprint.trim().split(/\s+/u);
  return parts[0] && parts[0].length > 0 ? parts[0] : "?";
}

export function VaultAvatar({ fingerprint }: Props) {
  return (
    <motion.button
      type="button"
      class="vault-avatar"
      title={`${t("vaults_label")} ${fingerprint}`}
      aria-label={t("vaults_switch_aria")}
      whileTap={TAP_SCALE}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SOFT_SPRING}
      onClick={() => {
        screen.value = "vaults";
      }}
    >
      <span class="vault-avatar__emoji" aria-hidden="true">
        {firstEmoji(fingerprint)}
      </span>
    </motion.button>
  );
}

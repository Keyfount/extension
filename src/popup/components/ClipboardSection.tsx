/**
 * Settings section for the clipboard auto-clear timer.
 *
 * Off, 10s, 30s (default), 60s, 120s. The choice persists in the
 * background state; every Copy action in the popup, badge, and detail
 * page arms a wipe using this value.
 */
import { motion } from "framer-motion";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING } from "../../shared/motion.js";

interface Props {
  seconds: number;
  onChange: () => Promise<void> | void;
}

const CHOICES: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: "clipboard_off" },
  { value: 10, labelKey: "clipboard_10s" },
  { value: 30, labelKey: "clipboard_30s" },
  { value: 60, labelKey: "clipboard_60s" },
  { value: 120, labelKey: "clipboard_120s" },
];

export function ClipboardSection({ seconds, onChange }: Props) {
  return (
    <motion.section
      class="flex flex-col gap-3"
      variants={{
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex flex-col gap-0.5">
        <h2 class="m-0 text-sm font-semibold tracking-[-0.01em]">{t("clipboard_section_title")}</h2>
        <span class="text-xs text-(--color-ink-muted) leading-snug">
          {t("clipboard_section_hint")}
        </span>
      </div>
      <div class="card p-3">
        <div class="segmented" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={seconds === choice.value}
              onClick={async () => {
                await send({ kind: "setClipboardClearSeconds", seconds: choice.value });
                await onChange();
              }}
            >
              {t(choice.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

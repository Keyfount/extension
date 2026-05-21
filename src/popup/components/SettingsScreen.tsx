import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send } from "../api.js";
import { Header } from "./Header.js";
import { ProfileEditor } from "../../shared/ProfileEditor.js";
import { PinSection } from "../../options/components/PinSection.js";
import { SitesSection } from "../../options/components/SitesSection.js";
import { DangerSection } from "../../options/components/DangerSection.js";
import { HistorySection } from "../../options/components/HistorySection.js";
import { AccountsSection } from "../../options/components/AccountsSection.js";
import { FaviconSection } from "./FaviconSection.js";
import { ClipboardSection } from "./ClipboardSection.js";
import { IconChevronRight } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { Profile } from "../../shared/types.js";
import { fingerprint, screen } from "../state.js";

interface State {
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  clipboardClearSeconds: number;
  accountsCount: number;
  sites: Record<string, Profile>;
}

/**
 * Settings screen that lives **inside** the popup, mirroring the options
 * page. Same sections, compacted to the 340px popup width.
 */
export function SettingsScreen() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await send({ kind: "getState" });
      let accountsCount = 0;
      if (res.historyEnabled) {
        try {
          const list = await send({ kind: "listAccounts" });
          accountsCount = list.entries.length;
        } catch {
          accountsCount = 0;
        }
      }
      setState({
        defaultProfile: res.defaultProfile,
        autoLockMinutes: res.autoLockMinutes,
        hasPin: res.hasPin,
        historyEnabled: res.historyEnabled,
        faviconFallbackEnabled: res.faviconFallbackEnabled,
        clipboardClearSeconds: res.clipboardClearSeconds,
        accountsCount,
        sites: res.sites,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load state");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={t("options_title")}
        fingerprint={fingerprint.value}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={() => {
              screen.value = "main";
            }}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />

      <AnimatePresence mode="wait">
        {error !== null ? (
          <motion.div
            key="error"
            class="callout callout-danger"
            role="alert"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {error}
          </motion.div>
        ) : state === null ? (
          <motion.div
            key="loading"
            class="flex flex-col gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div class="skeleton h-5 w-2/5" />
            <div class="skeleton h-12 w-full" />
            <div class="skeleton h-5 w-1/3" />
            <div class="skeleton h-9 w-full" />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            class="flex flex-col gap-6"
            initial="initial"
            animate="animate"
            variants={{
              initial: {},
              animate: { transition: { staggerChildren: 0.05 } },
            }}
          >
            <CompactSection title={t("options_default_section")} hint={t("options_default_hint")}>
              <ProfileEditor
                profile={state.defaultProfile}
                onChange={async (next) => {
                  await send({ kind: "setDefaultProfile", profile: next });
                  await refresh();
                }}
              />
            </CompactSection>

            <CompactSection title={t("options_autolock_section")} hint={t("options_autolock_hint")}>
              <label class="flex items-center justify-between gap-3">
                <span class="text-sm">{t("options_autolock_label")}</span>
                <input
                  class="input input-mono w-20"
                  type="number"
                  min={0}
                  max={1440}
                  value={state.autoLockMinutes}
                  onChange={async (e) => {
                    const minutes = Number.parseInt((e.target as HTMLInputElement).value, 10);
                    if (Number.isFinite(minutes)) {
                      await send({ kind: "setAutoLockMinutes", minutes });
                      await refresh();
                    }
                  }}
                />
              </label>
            </CompactSection>

            <PinSection hasPin={state.hasPin} onChange={refresh} />
            <HistorySection
              enabled={state.historyEnabled}
              hasEntries={state.accountsCount > 0}
              onChange={refresh}
            />
            <AccountsSection enabled={state.historyEnabled} />
            <FaviconSection enabled={state.faviconFallbackEnabled} onChange={refresh} />
            <ClipboardSection seconds={state.clipboardClearSeconds} onChange={refresh} />
            <SitesSection sites={state.sites} onChange={refresh} />
            <DangerSection onChange={refresh} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CompactSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ComponentChildren;
}) {
  return (
    <motion.section
      class="flex flex-col gap-3"
      variants={{
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex flex-col gap-0.5">
        <h2 class="m-0 text-sm font-semibold tracking-[-0.01em]">{title}</h2>
        {hint !== undefined ? (
          <span class="text-xs text-(--color-ink-muted) leading-snug">{hint}</span>
        ) : null}
      </div>
      <div class="card p-4">{children}</div>
    </motion.section>
  );
}

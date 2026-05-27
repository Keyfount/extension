/**
 * Vault switcher. Lists every profile (a.k.a. coffre) the user has set up
 * on this device, lets them switch the active one, add a brand-new one,
 * and delete those they no longer use.
 *
 * The visible identity for a profile is its 3-emoji fingerprint — the same
 * one that appears in the popup header — so swapping profiles feels like
 * swapping fingerprints.
 */
import { useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send } from "../api.js";
import { Header } from "./Header.js";
import { IconCheck, IconChevronRight, IconTrash } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { VaultMetaView } from "../../shared/messages.js";
import { errorMessage, fingerprint, hasPin, screen } from "../state.js";

export function VaultsScreen() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultMetaView[] | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const res = await send({ kind: "listVaults" });
      setActiveId(res.activeId);
      setVaults(res.vaults);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "could not load vaults";
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function switchTo(id: string): Promise<void> {
    if (id === activeId) return;
    setBusyId(id);
    try {
      await send({ kind: "switchVault", id });
      // Mirror what bootstrap() does so the unlock screen offers PIN mode
      // when the destination profile has one set.
      const status = await send({ kind: "status" });
      fingerprint.value = status.fingerprint;
      hasPin.value = status.hasPin;
      screen.value = status.isFirstRun ? "setup" : "unlock";
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "switch failed";
      setBusyId(null);
    }
  }

  async function addNew(): Promise<void> {
    try {
      await send({ kind: "startNewVault" });
      fingerprint.value = null;
      screen.value = "setup";
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "could not start new vault";
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setBusyId(id);
    try {
      await send({ kind: "deleteVault", id });
      setConfirmingDeleteId(null);
      await refresh();
      // If the deleted vault was active, we have no active session anymore
      // — reroute via bootstrap.
      const status = await send({ kind: "status" });
      fingerprint.value = status.fingerprint;
      if (status.isFirstRun) {
        // No vault left at all → setup. Otherwise stay on the vaults screen
        // so the user can pick one explicitly; locking already happened in
        // the router.
        screen.value = "setup";
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "delete failed";
    } finally {
      setBusyId(null);
    }
  }

  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={t("vaults_section_title")}
        fingerprint={fingerprint.value}
        showVaultAvatar={false}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={() => {
              screen.value = activeId === null ? "setup" : "main";
            }}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />

      <p class="text-xs text-(--color-ink-muted) leading-snug m-0">{t("vaults_section_hint")}</p>

      {vaults === null ? (
        <div class="flex flex-col gap-2">
          <div class="skeleton h-12 w-full" />
          <div class="skeleton h-12 w-full" />
        </div>
      ) : (
        <ul class="flex flex-col gap-2 list-none p-0 m-0">
          <AnimatePresence initial={false}>
            {vaults.map((v) => (
              <motion.li
                key={v.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={SOFT_SPRING}
                class="flex flex-col gap-2"
              >
                <div
                  class={`account-row${v.id === activeId ? " account-row--active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => void switchTo(v.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void switchTo(v.id);
                    }
                  }}
                >
                  <span class="fingerprint fingerprint-sm">{v.fingerprint || "—"}</span>
                  <span class="flex flex-col flex-1 min-w-0 text-left">
                    <span class="text-sm font-medium text-(--color-ink)">
                      {v.id === activeId ? t("vaults_active_label") : t("vaults_label")}
                    </span>
                    <span class="text-xs text-(--color-ink-muted) truncate">
                      {t("vaults_created_label", new Date(v.createdAt).toLocaleDateString())}
                    </span>
                  </span>
                  {v.id === activeId ? (
                    <span
                      class="text-(--color-accent-600) dark:text-(--color-accent-400) shrink-0"
                      aria-label={t("vaults_active_label")}
                    >
                      <IconCheck size={16} />
                    </span>
                  ) : null}
                  <motion.button
                    type="button"
                    class="btn btn-quiet btn-icon"
                    whileTap={TAP_SCALE}
                    aria-label={t("vaults_delete_aria")}
                    onClick={(event: Event) => {
                      event.stopPropagation();
                      setConfirmingDeleteId(v.id);
                    }}
                    disabled={busyId === v.id}
                  >
                    <IconTrash size={14} />
                  </motion.button>
                </div>

                {confirmingDeleteId === v.id ? (
                  <div class="callout callout-danger flex-col gap-3" role="alertdialog">
                    <span>{t("vaults_delete_confirm_body")}</span>
                    <div class="flex gap-2 justify-end">
                      <motion.button
                        type="button"
                        class="btn btn-quiet"
                        whileTap={TAP_SCALE}
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        {t("common_cancel")}
                      </motion.button>
                      <motion.button
                        type="button"
                        class="btn btn-danger"
                        whileTap={TAP_SCALE}
                        onClick={() => void confirmDelete(v.id)}
                        disabled={busyId === v.id}
                      >
                        {t("common_delete")}
                      </motion.button>
                    </div>
                  </div>
                ) : null}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <motion.button type="button" class="btn" whileTap={TAP_SCALE} onClick={() => void addNew()}>
        {t("vaults_add_cta")}
      </motion.button>

      {errorMessage.value !== null ? (
        <div class="field-error" role="alert">
          {errorMessage.value}
        </div>
      ) : null}
    </motion.div>
  );
}

/**
 * Detail page for one saved account.
 *
 * The screen is dedicated (a top-level Screen value), reached by clicking
 * a row in AccountList. It owns the entry's profile editor so changes only
 * affect this account — the per-site default is no longer involved once
 * the entry exists.
 */
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send, BackgroundError } from "../api.js";
import { copyWithAutoClear } from "../clipboard.js";
import { Header } from "./Header.js";
import { Favicon } from "./Favicon.js";
import { IconCheck, IconChevronRight, IconCopy, IconEye, IconEyeOff } from "../../shared/icons.js";
import { ProfileEditor } from "../../shared/ProfileEditor.js";
import { t } from "../../shared/i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { Profile } from "../../shared/types.js";
import { activeDomain, allAccounts, fingerprint, screen, selectedAccount } from "../state.js";

export function AccountDetailScreen() {
  const entry = selectedAccount.value;
  const [usernameDraft, setUsernameDraft] = useState(entry?.username ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"password" | "username" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Recompute password whenever the entry's profile changes (initial mount
  // + every profile mutation below).
  useEffect(() => {
    if (entry === null) return;
    let cancelled = false;
    setPassword(null);
    setRevealed(false);
    send({
      kind: "generate",
      domain: entry.domain,
      email: entry.username,
      profile: entry.profile,
    })
      .then((res) => {
        if (!cancelled) setPassword(res.password);
      })
      .catch(() => {
        if (!cancelled) setPassword(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.domain, entry?.username, entry?.profile]);

  // Reset the username draft when the user navigates to a different entry.
  useEffect(() => {
    setUsernameDraft(entry?.username ?? "");
    setRenameError(null);
  }, [entry?.domain, entry?.username]);

  const isActive = useMemo(
    () => entry !== null && entry.domain === activeDomain.value,
    [entry?.domain],
  );

  const back = useCallback(() => {
    screen.value = "main";
  }, []);

  if (entry === null) {
    return (
      <motion.div
        class="flex flex-col gap-4 p-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT_SPRING}
      >
        <Header
          subtitle={undefined}
          fingerprint={fingerprint.value}
          actions={
            <motion.button
              type="button"
              class="btn btn-quiet btn-icon"
              whileTap={TAP_SCALE}
              onClick={back}
              aria-label={t("common_back")}
            >
              <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
            </motion.button>
          }
        />
        <p class="text-(--color-ink-muted) text-sm">{t("detail_missing")}</p>
      </motion.div>
    );
  }

  const renameSubmit = async (event: Event) => {
    event.preventDefault();
    setRenameError(null);
    const next = usernameDraft.trim();
    if (next.length === 0 || next === entry.username) return;
    setBusy(true);
    try {
      const res = await send({
        kind: "renameAccount",
        domain: entry.domain,
        oldUsername: entry.username,
        newUsername: next,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
    } catch (error) {
      setRenameError(error instanceof BackgroundError ? error.message : t("detail_rename_failed"));
    } finally {
      setBusy(false);
    }
  };

  const updateProfile = async (next: Profile) => {
    setBusy(true);
    try {
      const res = await send({
        kind: "updateAccountProfile",
        domain: entry.domain,
        username: entry.username,
        profile: next,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
    } catch {
      /* swallowed */
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, kind: "password" | "username") => {
    try {
      await copyWithAutoClear(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* swallowed */
    }
  };

  const fillActiveTab = async () => {
    if (!isActive || password === null) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return;
      const u = entry.username;
      const p = password;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (uVal: string, pVal: string) => {
          const setVal = (input: HTMLInputElement, value: string) => {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            if (setter !== undefined) setter.call(input, value);
            else input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const pwd = document.querySelector<HTMLInputElement>('input[type="password"]');
          if (pwd !== null) setVal(pwd, pVal);
          const candidates = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[type="email"], input[type="text"], input:not([type])',
            ),
          ).filter((el) => el.offsetParent !== null);
          const target =
            candidates.find((el) =>
              /user|email|login/i.test([el.name, el.id, el.placeholder].join(" ")),
            ) ?? candidates[0];
          if (target !== undefined) setVal(target, uVal);
        },
        args: [u, p],
      });
      window.close();
    } catch {
      /* swallowed */
    }
  };

  const remove = async () => {
    await send({ kind: "deleteAccount", domain: entry.domain, username: entry.username });
    allAccounts.value = allAccounts.value.filter(
      (e) => !(e.domain === entry.domain && e.username === entry.username),
    );
    selectedAccount.value = null;
    screen.value = "main";
  };

  const usernameDirty = usernameDraft.trim().length > 0 && usernameDraft.trim() !== entry.username;

  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={entry.domain}
        fingerprint={fingerprint.value}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={back}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />

      <div class="flex items-center gap-3">
        <Favicon domain={entry.domain} size={40} />
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-semibold truncate text-(--color-ink)">{entry.domain}</span>
          <span class="text-xs text-(--color-ink-muted)">
            {new Date(entry.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <form class="flex flex-col gap-2" onSubmit={renameSubmit}>
        <span class="field-label">{t("main_username_label")}</span>
        <div class="flex gap-2">
          <input
            class="input flex-1"
            type="text"
            value={usernameDraft}
            onInput={(e) => setUsernameDraft((e.target as HTMLInputElement).value)}
          />
          <AnimatePresence>
            {usernameDirty ? (
              <motion.button
                key="save-username"
                type="submit"
                class="btn btn-sm"
                whileTap={TAP_SCALE}
                disabled={busy}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                {t("common_save")}
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
        {renameError !== null ? (
          <div class="field-error" role="alert">
            {renameError}
          </div>
        ) : null}
      </form>

      <motion.div
        class="flex flex-col gap-3 p-4 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line)"
        variants={POP_IN}
        initial="initial"
        animate="animate"
      >
        <span class="field-label">{t("detail_password_label")}</span>
        <code
          class={
            revealed
              ? "font-mono text-sm break-all select-all cursor-text text-(--color-ink) min-h-5"
              : "font-mono text-sm break-all select-all cursor-text text-(--color-ink-muted) min-h-5 tracking-[0.15em]"
          }
        >
          {password === null
            ? "•".repeat(20)
            : revealed
              ? password
              : "•".repeat(Math.min(password.length, 24))}
        </code>
        <div class="flex gap-2 flex-wrap">
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm flex-1"
            whileTap={TAP_SCALE}
            onClick={() => setRevealed((v) => !v)}
            disabled={password === null}
          >
            {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            {revealed ? t("common_hide") : t("common_reveal")}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm flex-1"
            whileTap={TAP_SCALE}
            onClick={() => password !== null && void copyText(password, "password")}
            disabled={password === null}
          >
            {copied === "password" ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied === "password" ? t("common_copied") : t("common_copy")}
          </motion.button>
          {isActive ? (
            <motion.button
              type="button"
              class="btn btn-sm flex-1"
              whileTap={TAP_SCALE}
              onClick={fillActiveTab}
              disabled={password === null}
            >
              {t("common_fill")}
            </motion.button>
          ) : null}
        </div>
      </motion.div>

      <motion.section
        class="flex flex-col gap-3"
        variants={{
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
        }}
      >
        <div class="flex flex-col gap-0.5">
          <h2 class="m-0 text-sm font-semibold tracking-[-0.01em]">
            {t("detail_profile_section")}
          </h2>
          <span class="text-xs text-(--color-ink-muted) leading-snug">
            {t("detail_profile_hint")}
          </span>
        </div>
        <div class="card p-4">
          <ProfileEditor profile={entry.profile} onChange={updateProfile} compact />
        </div>
      </motion.section>

      <div class="flex flex-col gap-2 pt-2">
        <span class="text-xs text-(--color-ink-subtle)">
          {t("detail_last_used", new Date(entry.lastUsedAt).toLocaleString())}
        </span>
        {confirmingDelete ? (
          <div class="callout callout-danger flex-col gap-3" role="alertdialog">
            <span>{t("detail_delete_confirm")}</span>
            <div class="flex gap-2">
              <motion.button
                type="button"
                class="btn btn-danger flex-1"
                whileTap={TAP_SCALE}
                onClick={() => void remove()}
              >
                {t("common_delete")}
              </motion.button>
              <motion.button
                type="button"
                class="btn btn-ghost flex-1"
                whileTap={TAP_SCALE}
                onClick={() => setConfirmingDelete(false)}
              >
                {t("common_cancel")}
              </motion.button>
            </div>
          </div>
        ) : (
          <motion.button
            type="button"
            class="btn btn-danger self-start"
            whileTap={TAP_SCALE}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("detail_delete_cta")}
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {copied === "username" ? (
          <motion.span
            class="text-xs text-(--color-ink-muted) self-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {t("common_copied")}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
